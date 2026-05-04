// Phase A.5 Step 6 — targeted re-run on rich-description exact/high listings.
//
// Runs triangulateLocation locally against each target, writes back via the
// same persist-result path the deployed endpoint uses (back up
// previous_geocoding only if missing, then merge new fields). Uses the
// Firestore-backed cache so cadastre / landmark / city-centroid lookups
// stay collapsed across runs.
//
// Usage:
//   node api/test/rerun-rich-description.js [--dry-run] [--max=N] [--parallelism=N]

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { triangulateLocation } = require('../src/lib/location-triangulation');
const { TriangulationCache } = require('../src/lib/triangulation-cache');

const PROGRESS_PATH = path.join(__dirname, 'rerun-rich-progress.json');

function parseArgs() {
    const out = { dryRun: false, max: Infinity, parallelism: 4 };
    for (const a of process.argv.slice(2)) {
        if (a === '--dry-run') out.dryRun = true;
        else if (a.startsWith('--max=')) out.max = parseInt(a.split('=')[1], 10);
        else if (a.startsWith('--parallelism=')) out.parallelism = parseInt(a.split('=')[1], 10);
    }
    return out;
}

function loadProgress() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); }
    catch (_) { return { processed: 0, before: {}, after: {}, totalCost: 0, errors: [], samples: [], tierDelta: {} }; }
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2)); }

function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function computeQualityScore(d, locationConfidence) {
    const conf = locationConfidence != null ? locationConfidence : d.locationConfidence;
    const confPts = ({ exact: 50, high: 40, medium: 25, low: 10 })[conf] || 0;
    const imgPts = Math.min(d.imageCount || (d.images ? d.images.length : 0), 10) * 3;
    const bedPts = (d.bedrooms || 0) > 0 ? 15 : 0;
    const price = d.price || 0;
    const pricePts = (price >= 50000 && price <= 5000000) ? 15 : 0;
    return confPts + imgPts + bedPts + pricePts;
}

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
        city: d.location || '', area: d.area || '',
        location: [d.subLocation, d.location, d.area].filter(Boolean).join(', '),
        neighbourhood: d.subLocation || '',
        bedrooms: d.bedrooms || 0, bathrooms: d.bathrooms || 0,
        size_m2: d.built || null, plot_m2: d.gardenPlot || null, terrace_m2: d.terrace || null,
        type: normalizedType,
        rawPropertyType: type, rawSubtype: sub,
        features: d.features || [],
        description_es: d.description_es || d.description || '',
        description_en: d.description_en || '',
        lat: d.lat || null, lng: d.lng || null
    };
}

async function persistResult(db, ref, originalDoc, result) {
    const update = {
        lat: result.lat, lng: result.lng,
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
    const explicitYr = result.year_built_extracted_confidence === 'explicit'
        ? result.year_built_extracted : null;
    const inferredYr = (result.year_built_extracted_confidence === 'inferred' || result.year_built_extracted_confidence === 'renovated')
        ? result.year_built_extracted : null;
    const cadastreYr = result.year_built_seed ? result.year_built_seed.year : null;
    update.year_built = explicitYr || cadastreYr || inferredYr || null;

    // previous_geocoding is one-time per doc — only write if not already set
    // (the original backfill set it; subsequent re-runs leave it alone so
    // the rollback always points back to the pre-Phase-A state).
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

(async function main() {
    const args = parseArgs();
    if (!process.env.ANTHROPIC_API_KEY || !process.env.MAPBOX_TOKEN || !process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        console.error('Missing one of ANTHROPIC_API_KEY, MAPBOX_TOKEN, FIREBASE_SERVICE_ACCOUNT_BASE64');
        process.exit(1);
    }
    const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    const db = admin.firestore();
    const cache = new TriangulationCache(db);

    // Build target ref set: locationConfidence ∈ {exact, high} AND
    // (description_es length > 500 OR description_en length > 500).
    console.log('Building target ref set…');
    const refs = [];
    const beforeTier = {};
    for (const tier of ['exact', 'high']) {
        const snap = await db.collection('listings').where('locationConfidence', '==', tier)
            .select('description_es', 'description_en', 'locationConfidence').get();
        snap.forEach(doc => {
            const d = doc.data();
            const e = (d.description_es || '').length;
            const n = (d.description_en || '').length;
            if (e > 500 || n > 500) {
                refs.push(doc.id);
                beforeTier[doc.id] = tier;
            }
        });
    }
    refs.sort();
    console.log('  targets:', refs.length);
    if (args.max < refs.length) {
        refs.length = args.max;
        console.log('  capped to:', refs.length);
    }
    if (args.dryRun) { console.log('Dry run.'); process.exit(0); }

    const progress = loadProgress();
    const samples = progress.samples || [];
    let totalCost = progress.totalCost || 0;
    const errors = progress.errors || [];
    const tierDelta = progress.tierDelta || {};
    if (!progress.before || !Object.keys(progress.before).length) {
        progress.before = { exact: 0, high: 0 };
        for (const r of refs) progress.before[beforeTier[r]] = (progress.before[beforeTier[r]] || 0) + 1;
        saveProgress(progress);
    }

    const startIdx = progress.processed || 0;
    console.log('Resume from:', startIdx, '(remaining:', refs.length - startIdx, ')');
    const tStart = Date.now();

    // Process in waves of `parallelism` properties at a time.
    for (let i = startIdx; i < refs.length; i += args.parallelism) {
        const wave = refs.slice(i, i + args.parallelism);
        const settled = await Promise.allSettled(wave.map(async (ref) => {
            const snap = await db.collection('listings').doc(ref).get();
            if (!snap.exists) return { ref, skipped: 'not-found' };
            const data = snap.data();
            const oldTier = data.locationConfidence;
            const oldLat = data.lat, oldLng = data.lng;
            const input = toTriangulatorInput(ref, data);
            const r = await triangulateLocation(input, { mapboxToken: process.env.MAPBOX_TOKEN, cache });
            await persistResult(db, ref, data, r);
            const moved = (Number.isFinite(oldLat) && Number.isFinite(r.lat))
                ? Math.round(haversineMeters(oldLat, oldLng, r.lat, r.lng)) : null;
            return {
                ref, oldTier, newTier: r.locationConfidence, oldLat, oldLng,
                newLat: r.lat, newLng: r.lng, moved,
                source: r.locationSource,
                centroid_vs_anchor_m: r.reasoning_trace && r.reasoning_trace.centroid_vs_anchor_m,
                cost: ((r.usage && r.usage.input_tokens) || 0) / 1e6 +
                      ((r.usage && r.usage.output_tokens) || 0) * 5 / 1e6
            };
        }));
        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value && !s.value.skipped) {
                const v = s.value;
                totalCost += v.cost;
                const k = (v.oldTier || '?') + '→' + (v.newTier || '?');
                tierDelta[k] = (tierDelta[k] || 0) + 1;
                samples.push({
                    ref: v.ref, oldTier: v.oldTier, newTier: v.newTier,
                    oldCoord: { lat: v.oldLat, lng: v.oldLng },
                    newCoord: { lat: v.newLat, lng: v.newLng },
                    moved: v.moved, source: v.source,
                    centroid_vs_anchor_m: v.centroid_vs_anchor_m
                });
            } else if (s.status === 'rejected') {
                errors.push({ error: String(s.reason && s.reason.message || s.reason).slice(0, 200) });
            }
        }
        progress.processed = Math.min(i + args.parallelism, refs.length);
        progress.totalCost = totalCost;
        progress.tierDelta = tierDelta;
        progress.samples = samples;
        progress.errors = errors;
        saveProgress(progress);

        if ((i / args.parallelism) % 10 === 0 || progress.processed === refs.length) {
            console.log('[' + progress.processed + '/' + refs.length + ']  cum=$' + totalCost.toFixed(4) +
                '  ' + Math.round((Date.now() - tStart) / 1000) + 's wall  errors=' + errors.length);
        }
    }

    // After-state
    const after = {};
    for (const ref of refs) {
        const d = await db.collection('listings').doc(ref).get();
        const t = d.data() && d.data().locationConfidence;
        after[t] = (after[t] || 0) + 1;
    }
    progress.after = after;
    saveProgress(progress);

    const elapsedSec = Math.round((Date.now() - tStart) / 1000);
    console.log('\n══ Summary ══');
    console.log('Targets:           ', refs.length);
    console.log('Processed (this run):', refs.length - startIdx);
    console.log('Before:            ', JSON.stringify(progress.before));
    console.log('After:             ', JSON.stringify(after));
    console.log('Tier transitions:  ', JSON.stringify(tierDelta));
    console.log('Cost:              $' + totalCost.toFixed(4));
    console.log('Wall time:         ', elapsedSec, 's');
    console.log('Errors:            ', errors.length);
    console.log('Cache hits/misses: coord=' + cache.stats.coord_hit + '/' + cache.stats.coord_miss +
        '  parcel=' + cache.stats.parcel_hit + '/' + cache.stats.parcel_miss +
        '  landmark=' + cache.stats.landmark_hit + '/' + cache.stats.landmark_miss +
        '  city=' + cache.stats.city_hit + '/' + cache.stats.city_miss);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
