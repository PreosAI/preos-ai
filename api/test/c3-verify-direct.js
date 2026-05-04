// C3.3 verification: read listings directly from Firestore so we can see
// the new triangulation fields (previous_geocoding, location_reasoning,
// locationSource, year_built_cadastre) that the public mappers don't expose.

const admin = require('firebase-admin');

const REGRESSION_IDS = ['R166233', 'R2036289', 'R2057570', 'R2043104'];

function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

(async function main() {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!b64) { console.error('FIREBASE_SERVICE_ACCOUNT_BASE64 not set'); process.exit(1); }
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    const db = admin.firestore();

    // 4 known-broken regression cases
    console.log('══ 4 known-broken regression cases ══\n');
    for (const id of REGRESSION_IDS) {
        const snap = await db.collection('listings').doc(id).get();
        if (!snap.exists) { console.log(id + ' NOT FOUND'); continue; }
        const d = snap.data();
        const prev = d.previous_geocoding;
        const moved = (prev && Number.isFinite(prev.lat) && Number.isFinite(d.lat))
            ? Math.round(haversineMeters(prev.lat, prev.lng, d.lat, d.lng)) : null;
        const muni = d.location_reasoning && d.location_reasoning.municipality_resolution;
        const winningStrike = muni && (muni.strikes||[]).filter(s=>s.matched).pop();

        console.log('--- ' + id + ' (' + (d.location || d.city || '?') + ') ---');
        console.log('  city:           ' + d.location);
        console.log('  type:           ' + d.propertyType);
        console.log('  m²:             ' + d.built);
        console.log('  prev coords:    ' + (prev ? prev.lat + ', ' + prev.lng : '(none)') + ' | conf=' + (prev ? prev.locationConfidence : '-'));
        console.log('  new coords:     ' + d.lat + ', ' + d.lng + ' | ' + d.locationConfidence + '/' + (d.locationSource || '-'));
        console.log('  moved:          ' + (moved == null ? 'n/a' : moved + ' m'));
        console.log('  strike:         ' + (winningStrike ? winningStrike.strike + ' (' + winningStrike.source + ')' : 'rejected'));
        console.log('  expected_muni:  ' + (muni ? muni.expected_municipality : '-'));
        console.log('  cadastre addr:  ' + (d.location_reasoning && d.location_reasoning.cadastre_check && d.location_reasoning.cadastre_check.closest_parcel ? d.location_reasoning.cadastre_check.closest_parcel.address : '-'));
        console.log('  cadastre score: ' + (d.location_reasoning && d.location_reasoning.cadastre_check && d.location_reasoning.cadastre_check.best_match ? d.location_reasoning.cadastre_check.best_match.score : '-'));
        console.log('  year_built:     extracted=' + (d.year_built_extracted || '-') + '/' + (d.year_built_extracted_confidence || '-') + '  cadastre=' + (d.year_built_cadastre || '-') + '  resolved=' + (d.year_built || '-'));
        console.log('  reason:         ' + (d.location_reasoning ? (d.location_reasoning.final_decision_reason || '-').slice(0, 120) : '-'));
    }

    // Random 20 spot-check
    console.log('\n══ 20 random spot-checks ══\n');
    const allRefs = [];
    const allSnap = await db.collection('listings').select().get();
    allSnap.forEach(d => allRefs.push(d.id));
    // Seeded shuffle for reproducibility
    let seed = 0xC3FACE;
    function rand() { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; }
    const sampled = [];
    while (sampled.length < 20) {
        const i = Math.floor(rand() * allRefs.length);
        const ref = allRefs[i];
        if (!sampled.includes(ref)) sampled.push(ref);
    }
    let acc = 0, low = 0, rej = 0;
    for (const id of sampled) {
        const snap = await db.collection('listings').doc(id).get();
        const d = snap.data();
        const muni = d.location_reasoning && d.location_reasoning.municipality_resolution;
        const winningStrike = muni && (muni.strikes||[]).filter(s=>s.matched).pop();
        const cad = d.location_reasoning && d.location_reasoning.cadastre_check && d.location_reasoning.cadastre_check.closest_parcel;
        console.log(id.padEnd(11) + ' ' + (d.location || '').slice(0,22).padEnd(22) + ' ' +
            (d.locationConfidence || '-').padEnd(9) + ' strike=' + (winningStrike ? winningStrike.strike : 'rej') +
            '  cad=' + (cad ? (cad.address || '').slice(0,40) : '-'));
        if (d.locationConfidence === 'rejected') rej++;
        else if (d.locationConfidence === 'low') low++;
        else acc++;
    }
    console.log('\nSpot-check tally:');
    console.log('  exact/high/medium:', acc);
    console.log('  low (centroid):    ', low);
    console.log('  rejected:          ', rej);

    // Year-built breakdown
    const yearStats = await db.collection('listings').select('year_built', 'year_built_extracted', 'year_built_cadastre').get();
    let totalYr=0, fromExt=0, fromCad=0;
    yearStats.forEach(d => {
        const v = d.data();
        if (v.year_built) totalYr++;
        if (v.year_built_extracted) fromExt++;
        if (v.year_built_cadastre) fromCad++;
    });
    console.log('\nYear-built coverage across corpus:');
    console.log('  total resolved year_built: ' + totalYr + ' (' + (100*totalYr/8452).toFixed(1) + '%)');
    console.log('  via LLM extraction:        ' + fromExt + ' (' + (100*fromExt/8452).toFixed(1) + '%)');
    console.log('  via cadastre seed:         ' + fromCad + ' (' + (100*fromCad/8452).toFixed(1) + '%)');

    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
