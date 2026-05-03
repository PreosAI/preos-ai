// Cadastre smoke test (Phase A, Checkpoint 1.2).
//
// Pulls 5 listings with high locationConfidence + complete metadata
// (m²_built, year_built, type) from the deployed listings endpoint, then
// runs each through lookupByCoords → matchParcelToListing. Reports the
// best match and the metadata fit breakdown so we can judge whether the
// cadastre verification step is going to be useful before building the
// triangulation pipeline on top of it.
//
// Run from repo root:
//   node api/test/cadastre-smoke.js
//
// No Firestore creds needed — uses the public listings API.

const path = require('path');
const { lookupByCoords, matchParcelToListing } = require(path.join(__dirname, '..', 'src', 'lib', 'cadastre.js'));

const LISTINGS_URL = 'https://preos-resales-proxy.azurewebsites.net/api/resales/listings';

// Pick 5 listings that maximise our chance of confidently matching a parcel:
//   - locationConfidence === 'high' (Mapbox already nailed the city/area)
//   - lat & lng present
//   - m²_built > 0
//   - type is residential (Apartamento / Villa / Adosado / Ático)
//
// Spread across cities so we don't accidentally test 5 listings in the same
// urbanization.
function pickFive(listings) {
    const seenCities = new Set();
    const candidates = listings.filter(p =>
        p.locationConfidence === 'high' &&
        Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
        p.size_m2 && p.size_m2 > 30 &&
        ['Apartamento', 'Villa', 'Adosado', 'Ático'].includes(p.type)
    );
    const picked = [];
    for (const p of candidates) {
        if (picked.length >= 5) break;
        const key = (p.city || '').toLowerCase();
        if (seenCities.has(key)) continue;
        seenCities.add(key);
        picked.push(p);
    }
    return picked;
}

(async function main() {
    console.log('Fetching listings from', LISTINGS_URL, '…');
    const t0 = Date.now();
    const res = await fetch(LISTINGS_URL);
    if (!res.ok) {
        console.error('listings fetch failed:', res.status);
        process.exit(1);
    }
    const all = await res.json();
    console.log('  got', all.length, 'listings in', ((Date.now() - t0) / 1000).toFixed(1), 's');

    const picked = pickFive(all);
    console.log('Picked', picked.length, 'test properties:');
    for (const p of picked) {
        console.log('  -', p.id, '|', p.type, '|', p.city, '|', p.size_m2, 'm² |', 'year:', p.year_built || 'n/a',
            '| coords:', p.lat.toFixed(5), p.lng.toFixed(5));
    }

    let confidentMatches = 0;
    const results = [];
    for (const p of picked) {
        console.log('\n──', p.id, '(' + p.city + ')', '──');
        let parcels = [];
        try {
            parcels = await lookupByCoords(p.lat, p.lng);
        } catch (e) {
            console.log('  lookupByCoords FAILED:', e.message);
            results.push({ id: p.id, error: 'rccoor: ' + e.message });
            continue;
        }
        console.log('  cadastre returned', parcels.length, 'nearby parcels',
            parcels.length ? '(closest=' + parcels[0].distance + 'm)' : '');

        if (parcels.length === 0) {
            results.push({ id: p.id, parcels: 0 });
            continue;
        }

        const listingMeta = {
            m2_built: p.size_m2,
            year_built: p.year_built || null,
            type: p.type
        };

        const match = await matchParcelToListing(parcels, listingMeta, { maxParcels: 5 });
        console.log('  candidates inspected:', match.candidates.length);
        for (const c of match.candidates) {
            const flag = match.match && c.refcat === match.match.refcat ? '*' : ' ';
            console.log('  ' + flag, c.refcat, '| dist=' + c.distance + 'm',
                '| score=' + (c.score != null ? c.score : 'err'),
                '| addr=' + (c.address || '').slice(0, 60));
            if (c.breakdown) {
                console.log('     m²:', JSON.stringify(c.breakdown.m2));
                console.log('     yr:', JSON.stringify(c.breakdown.year));
                console.log('     use:', JSON.stringify(c.breakdown.useType));
            }
        }

        if (match.match && match.match.score >= 50) {
            confidentMatches++;
            console.log('  ✓ CONFIDENT MATCH score=' + match.match.score);
        } else {
            console.log('  ✗ no confident match');
        }

        results.push({
            id: p.id, city: p.city, m2: p.size_m2,
            best: match.match ? { refcat: match.match.refcat, score: match.match.score, dist: match.match.distance } : null,
            candidates: match.candidates.length
        });
    }

    console.log('\n' + '═'.repeat(60));
    console.log('SUMMARY:', confidentMatches + '/' + picked.length, 'properties produced confident cadastre match (score≥50)');
    console.log(JSON.stringify(results, null, 2));
})().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
