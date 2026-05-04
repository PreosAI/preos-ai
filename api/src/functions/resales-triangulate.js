// POST /api/resales/triangulate-locations — Phase A · Checkpoint 3 backfill.
//
// Iterates the listings collection in cursor order (by reference) and runs
// the triangulation pipeline on each property. Results are written back to
// listings/{ref} alongside a one-time `previous_geocoding` snapshot for
// rollback safety.
//
// Time-budgeted at 200 s per call so we stay well under the 230 s Azure
// gateway timeout. The client (a driver script or another caller) loops
// the endpoint with the returned nextCursor until status='complete'.
//
// Caching: triangulation-cache.js Firestore collections persist across
// invocations. Within an invocation an in-memory mirror collapses
// duplicate Firestore reads.
//
// Parallelism: properties within a batch are processed in parallel waves
// of `parallelism` (default 5). The cadastre throttle is process-global,
// so within a wave only one cadastre call runs at a time, but the LLM
// and Mapbox work overlaps freely. Net wall-time ~3-4× faster than
// strictly serial.

const { app } = require('@azure/functions');
const admin = require('firebase-admin');
const { triangulateLocation } = require('../lib/location-triangulation');
const { TriangulationCache } = require('../lib/triangulation-cache');

let db;
function getDb() {
    if (db) return db;
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 not set');
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    db = admin.firestore();
    return db;
}

function computeQualityScore(d, locationConfidence) {
    const conf = locationConfidence != null ? locationConfidence : d.locationConfidence;
    // Promoted scoring for the new tiers:
    //   exact   → 50 (was 'high'=40 in the old single-scale)
    //   high    → 40
    //   medium  → 25
    //   low     → 10
    //   rejected/null → 0
    const confPts = ({ exact: 50, high: 40, medium: 25, low: 10 })[conf] || 0;
    const imgPts = Math.min(d.imageCount || (d.images ? d.images.length : 0), 10) * 3;
    const bedPts = (d.bedrooms || 0) > 0 ? 15 : 0;
    const price = d.price || 0;
    const pricePts = (price >= 50000 && price <= 5000000) ? 15 : 0;
    return confPts + imgPts + bedPts + pricePts;
}

// Take a slice of the listings collection starting after `cursor` (or from
// the beginning if null), ordered deterministically by reference. When
// `confidenceFilter` is set we only return listings whose locationConfidence
// matches it — used for the post-fix targeted re-run on rejected docs.
async function loadBatch(db, cursor, batchSize, confidenceFilter) {
    let q = db.collection('listings').orderBy(admin.firestore.FieldPath.documentId());
    if (confidenceFilter) {
        // Composite query: where + orderBy on documentId requires no extra
        // index (it's the natural document order). Confidence filter is
        // applied first — Firestore narrows by index, then orderBy.
        q = db.collection('listings')
            .where('locationConfidence', '==', confidenceFilter)
            .orderBy(admin.firestore.FieldPath.documentId());
    }
    if (cursor) {
        const cursorSnap = await db.collection('listings').doc(cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
    }
    q = q.limit(batchSize);
    const snap = await q.get();
    const out = [];
    snap.forEach(doc => out.push({ ref: doc.id, data: doc.data() }));
    return out;
}

// Map Firestore listing → triangulator input shape.
// triangulateLocation expects fields like: id, city, area, location, neighbourhood,
// bedrooms, bathrooms, size_m2, plot_m2, terrace_m2, type, features,
// description_es, description_en, lat, lng.
function toTriangulatorInput(ref, d) {
    const type = d.propertyType || 'Propiedad';
    const sub = d.subtype || '';
    const t = (type + ' ' + sub).toLowerCase();
    let normalizedType = type;
    if (t.indexOf('apartment') > -1 || t.indexOf('flat') > -1 || t.indexOf('studio') > -1) normalizedType = 'Apartamento';
    else if (t.indexOf('villa') > -1 || t.indexOf('chalet') > -1 || t.indexOf('house') > -1 || t.indexOf('casa') > -1) normalizedType = 'Villa';
    else if (t.indexOf('townhouse') > -1 || t.indexOf('semi') > -1) normalizedType = 'Adosado';
    else if (t.indexOf('penthouse') > -1) normalizedType = 'Ático';
    else if (t.indexOf('plot') > -1 || t.indexOf('land') > -1) normalizedType = 'Solar';
    else if (t.indexOf('commercial') > -1) normalizedType = 'Local';

    return {
        id: ref,
        city: d.location || '',
        area: d.area || '',
        location: [d.subLocation, d.location, d.area].filter(Boolean).join(', '),
        neighbourhood: d.subLocation || '',
        bedrooms: d.bedrooms || 0,
        bathrooms: d.bathrooms || 0,
        size_m2: d.built || null,
        plot_m2: d.gardenPlot || null,
        terrace_m2: d.terrace || null,
        type: normalizedType,
        // Raw Resales type / subtype strings — needed by the type-eligibility
        // gate in assignTier (Phase A.5). The normalizer collapses unrelated
        // raw types into shared buckets ("Apartment Complex" → 'Apartamento'),
        // which would let non-residential cases sneak past a normalized-type
        // whitelist; keep the originals so the gate sees the full picture.
        rawPropertyType: type,
        rawSubtype: sub,
        features: d.features || [],
        description_es: d.description_es || d.description || '',
        description_en: d.description_en || '',
        lat: d.lat || null,
        lng: d.lng || null
    };
}

// Apply triangulation result to a Firestore listing — snapshot existing
// geocoding fields once (idempotent against re-runs), then merge the new
// triangulation outputs and recomputed quality_score.
async function persistResult(db, ref, originalDoc, result) {
    const update = {
        lat: result.lat,
        lng: result.lng,
        locationConfidence: result.locationConfidence,
        locationSource: result.locationSource,
        location_reasoning: result.reasoning_trace,
        triangulated_at: admin.firestore.FieldValue.serverTimestamp(),
        quality_score: computeQualityScore(originalDoc, result.locationConfidence)
    };
    if (result.year_built_extracted) {
        update.year_built_extracted = result.year_built_extracted;
        update.year_built_extracted_confidence = result.year_built_extracted_confidence || null;
    }
    if (result.year_built_seed) {
        update.year_built_cadastre = result.year_built_seed.year || null;
        update.year_built_cadastre_source_refcat = result.year_built_seed.refcat || null;
    }

    // Compute the resolved year_built field per the Option D priority chain.
    const explicitYr = result.year_built_extracted_confidence === 'explicit'
        ? result.year_built_extracted : null;
    const inferredYr = (result.year_built_extracted_confidence === 'inferred' || result.year_built_extracted_confidence === 'renovated')
        ? result.year_built_extracted : null;
    const cadastreYr = result.year_built_seed ? result.year_built_seed.year : null;
    update.year_built = explicitYr || cadastreYr || inferredYr || null;

    // One-time backup snapshot of the previous geocoding fields. Only write
    // it if it doesn't already exist on the doc — idempotent against re-runs.
    if (!originalDoc.previous_geocoding) {
        update.previous_geocoding = {
            lat: originalDoc.lat || null,
            lng: originalDoc.lng || null,
            locationConfidence: originalDoc.locationConfidence || null,
            locationSource: originalDoc.locationSource || null,
            snapshot_timestamp: admin.firestore.FieldValue.serverTimestamp()
        };
    }

    await db.collection('listings').doc(ref).set(update, { merge: true });
}

// Determine the strike that "won" for a given result by inspecting the
// reasoning trace's municipality_resolution.strikes array.
function winningStrikeFor(result) {
    const muni = result.reasoning_trace && result.reasoning_trace.municipality_resolution;
    if (!muni) return result.locationConfidence === 'rejected' ? 'rejected' : 'none';
    if (result.locationConfidence === 'rejected') return 'rejected';
    const last = (muni.strikes || []).filter(s => s.matched).pop();
    return last ? last.strike : 'none';
}

app.http('resales-triangulate-locations', {
    methods: ['POST', 'GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/triangulate-locations',
    handler: async (request, context) => {
        if (request.method === 'OPTIONS') return { status: 204 };

        const mapboxToken = process.env.MAPBOX_TOKEN;
        if (!mapboxToken) return { status: 500, jsonBody: { error: 'MAPBOX_TOKEN not configured' } };
        if (!process.env.ANTHROPIC_API_KEY) return { status: 500, jsonBody: { error: 'ANTHROPIC_API_KEY not configured' } };

        const startCursor = request.query.get('startCursor') || null;
        const batchSize = Math.max(1, Math.min(200, parseInt(request.query.get('batchSize') || '50', 10)));
        const parallelism = Math.max(1, Math.min(20, parseInt(request.query.get('parallelism') || '5', 10)));
        const confidenceFilter = request.query.get('only') || null; // e.g. 'rejected' for targeted retry
        const TIME_BUDGET_MS = 200_000;
        const tStart = Date.now();

        const db = getDb();
        const cache = new TriangulationCache(db);

        let cursor = startCursor;
        let processed = 0;
        const errors = [];
        const confidenceDist = { exact: 0, high: 0, medium: 0, low: 0, rejected: 0, error: 0 };
        const strikeDist = { 1: 0, 2: 0, 3: 0, rejected: 0, none: 0 };
        let yearSeedCount = 0;
        let totalInputTokens = 0, totalOutputTokens = 0;
        let lastSuccessfulRef = null;
        let collectionExhausted = false;

        try {
            while (Date.now() - tStart < TIME_BUDGET_MS) {
                const remainingTime = TIME_BUDGET_MS - (Date.now() - tStart);
                if (remainingTime < 8_000) break; // need at least one wave's worth of time

                const batch = await loadBatch(db, cursor, parallelism, confidenceFilter);
                if (batch.length === 0) {
                    collectionExhausted = true;
                    break;
                }

                // Process the wave in parallel.
                const settled = await Promise.allSettled(batch.map(async ({ ref, data }) => {
                    const input = toTriangulatorInput(ref, data);
                    const result = await triangulateLocation(input, { mapboxToken, cache });
                    await persistResult(db, ref, data, result);
                    return { ref, result };
                }));

                for (let i = 0; i < settled.length; i++) {
                    const s = settled[i];
                    const ref = batch[i].ref;
                    if (s.status === 'fulfilled') {
                        const r = s.value.result;
                        const tier = r.locationConfidence || 'rejected';
                        confidenceDist[tier] = (confidenceDist[tier] || 0) + 1;
                        const strike = winningStrikeFor(r);
                        strikeDist[strike] = (strikeDist[strike] || 0) + 1;
                        if (r.year_built_seed && r.year_built_seed.year) yearSeedCount++;
                        if (r.usage) {
                            totalInputTokens += r.usage.input_tokens || 0;
                            totalOutputTokens += r.usage.output_tokens || 0;
                        }
                    } else {
                        confidenceDist.error++;
                        errors.push({ ref, error: String(s.reason && s.reason.message || s.reason).slice(0, 240) });
                        // Halt on Anthropic 4xx/5xx — non-recoverable, per Phase A rules.
                        const m = String(s.reason && s.reason.message || '');
                        if (/Anthropic [45]\d\d/.test(m)) {
                            throw s.reason;
                        }
                    }
                    processed++;
                    lastSuccessfulRef = ref;
                }

                // Cursor is the LAST processed ref (success or not — we want to skip past it).
                cursor = lastSuccessfulRef || cursor;
            }
        } catch (err) {
            context.error('Backfill halted:', err.message, err.stack);
            return {
                status: 200,
                jsonBody: {
                    status: 'halted',
                    reason: err.message,
                    processed,
                    nextCursor: cursor,
                    confidence_distribution: confidenceDist,
                    strike_distribution: strikeDist,
                    cache_stats: cache.stats,
                    errors: errors.slice(0, 25)
                }
            };
        }

        const elapsedMs = Date.now() - tStart;
        const cost = (totalInputTokens / 1e6) * 1.0 + (totalOutputTokens / 1e6) * 5.0;
        return {
            status: 200,
            jsonBody: {
                status: collectionExhausted ? 'complete' : 'partial',
                processed,
                elapsed_ms: elapsedMs,
                nextCursor: collectionExhausted ? null : cursor,
                confidence_distribution: confidenceDist,
                strike_distribution: strikeDist,
                year_seed_count: yearSeedCount,
                cache_stats: cache.stats,
                tokens: { input: totalInputTokens, output: totalOutputTokens, cost_usd: parseFloat(cost.toFixed(4)) },
                errors: errors.slice(0, 25)
            }
        };
    }
});
