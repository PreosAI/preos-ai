// Targeted re-run on properties currently at exact tier — checks whether
// the new "all_landmarks_collapsed → cap at high" rule demotes any of them.

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { triangulateLocation } = require('../src/lib/location-triangulation');
const { TriangulationCache } = require('../src/lib/triangulation-cache');

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
    await db.collection('listings').doc(ref).set(update, { merge: true });
}

(async function main() {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.MAPBOX_TOKEN || !process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        console.error('Missing creds'); process.exit(1);
    }
    const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    const db = admin.firestore();
    const cache = new TriangulationCache(db);

    console.log('Fetching current exact-tier listings…');
    const snap = await db.collection('listings').where('locationConfidence', '==', 'exact').get();
    const targets = [];
    snap.forEach(d => targets.push(d.id));
    targets.sort();
    console.log('  targets:', targets.length);

    const samples = [];
    let totalCost = 0;
    const tierDelta = {};
    const tStart = Date.now();
    const PARALLEL = 4;

    for (let i = 0; i < targets.length; i += PARALLEL) {
        const wave = targets.slice(i, i + PARALLEL);
        const settled = await Promise.allSettled(wave.map(async (ref) => {
            const docSnap = await db.collection('listings').doc(ref).get();
            const data = docSnap.data();
            const oldTier = data.locationConfidence;
            const oldLat = data.lat, oldLng = data.lng;
            const input = toTriangulatorInput(ref, data);
            const r = await triangulateLocation(input, { mapboxToken: process.env.MAPBOX_TOKEN, cache });
            await persistResult(db, ref, data, r);
            const moved = (Number.isFinite(oldLat) && Number.isFinite(r.lat))
                ? Math.round(haversineMeters(oldLat, oldLng, r.lat, r.lng)) : null;
            const collapsed = (r.reasoning_trace && r.reasoning_trace.landmarks_collapsed) || [];
            return {
                ref, oldTier, newTier: r.locationConfidence,
                moved, source: r.locationSource,
                landmarks_collapsed_count: collapsed.length,
                landmarks_resolved_count: ((r.reasoning_trace && r.reasoning_trace.landmarks_resolved) || []).length,
                cost: ((r.usage && r.usage.input_tokens) || 0) / 1e6 +
                      ((r.usage && r.usage.output_tokens) || 0) * 5 / 1e6,
                reason: r.reasoning_trace && r.reasoning_trace.final_decision_reason
            };
        }));
        for (const s of settled) {
            if (s.status === 'fulfilled') {
                const v = s.value;
                totalCost += v.cost;
                const k = v.oldTier + '→' + v.newTier;
                tierDelta[k] = (tierDelta[k] || 0) + 1;
                samples.push(v);
            } else {
                console.log('  ERROR:', s.reason && s.reason.message);
            }
        }
        if ((i / PARALLEL) % 5 === 0) {
            console.log('[' + Math.min(i + PARALLEL, targets.length) + '/' + targets.length + ']  cum=$' + totalCost.toFixed(4));
        }
    }

    console.log('\nTier transitions:', JSON.stringify(tierDelta));
    console.log('Total cost: $' + totalCost.toFixed(4));
    console.log('Wall:', Math.round((Date.now() - tStart) / 1000), 's');

    fs.writeFileSync(path.join(__dirname, 'rerun-current-exacts-progress.json'), JSON.stringify({
        targets: targets.length, tierDelta, totalCost, samples
    }, null, 2));

    console.log('\nDemotions caused by all_landmarks_collapsed:');
    for (const v of samples) {
        if (v.oldTier === 'exact' && v.newTier !== 'exact') {
            const flag = (v.reason || '').includes('all_landmarks_collapsed') ? 'collapsed' :
                         (v.reason || '').includes('address_token_match=false') ? 'token-mismatch' : 'other';
            console.log('  ' + v.ref + '  → ' + v.newTier + ' (' + flag + ')  collapsed=' + v.landmarks_collapsed_count + ' resolved=' + v.landmarks_resolved_count);
        }
    }

    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
