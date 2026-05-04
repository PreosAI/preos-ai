// C3.3 verification: pull updated docs from the deployed listings endpoint,
// run regression checks on the 4 known-broken cases, sample 20 random for
// spot-checks, summarise the rejection breakdown.

const fs = require('fs');
const path = require('path');
const LISTINGS_URL = 'https://preos-resales-proxy.azurewebsites.net/api/resales/listings';
const PROPERTY_URL = (id) => 'https://preos-resales-proxy.azurewebsites.net/api/resales/property/' + id;

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
    console.log('Fetching listings…');
    const all = await (await fetch(LISTINGS_URL)).json();
    console.log('  got', all.length, 'listings\n');

    // Aggregate by tier from /listings response (this is the live frontend view).
    const tiers = {};
    for (const p of all) {
        const t = p.locationConfidence || 'none';
        tiers[t] = (tiers[t] || 0) + 1;
    }
    console.log('Tier distribution from /api/resales/listings:');
    for (const [k, v] of Object.entries(tiers).sort((a, b) => b[1] - a[1])) {
        console.log('  ' + k.padEnd(10) + ' ' + v + ' (' + (100*v/all.length).toFixed(1) + '%)');
    }

    // Cities that account for rejections — diagnose the 33% rate.
    const rejByCity = {};
    for (const p of all) {
        if (p.locationConfidence !== 'rejected') continue;
        const c = p.city || '(empty)';
        rejByCity[c] = (rejByCity[c] || 0) + 1;
    }
    const top = Object.entries(rejByCity).sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log('\nTop 20 cities by rejected count:');
    for (const [c, n] of top) console.log('  ' + n.toString().padStart(4) + ' ' + c);

    // Regression cases — pull each via the /property/<ref> endpoint to get the
    // full Firestore doc with reasoning_trace.
    console.log('\n══ 4 known-broken regression cases ══');
    for (const id of REGRESSION_IDS) {
        const p = all.find(x => x.id === id);
        if (!p) { console.log('  ' + id + ' NOT FOUND in listings'); continue; }
        const prev = p.previous_geocoding || null;
        const oldLat = prev ? prev.lat : null, oldLng = prev ? prev.lng : null;
        const moved = (Number.isFinite(oldLat) && Number.isFinite(p.lat))
            ? Math.round(haversineMeters(oldLat, oldLng, p.lat, p.lng)) : null;

        // Pull full doc for reasoning_trace.
        let detail = null;
        try {
            detail = await (await fetch(PROPERTY_URL(id))).json();
        } catch (_) {}
        const trace = detail && detail.location_reasoning;
        const muni = trace && trace.municipality_resolution;
        const strikeWin = muni && (muni.strikes||[]).filter(s=>s.matched).pop();
        const strike = strikeWin ? strikeWin.strike : (p.locationConfidence === 'rejected' ? 'rejected' : '-');

        console.log('\n' + id + ' (' + (p.city || '?') + ')');
        console.log('  old coords:', oldLat, oldLng, '|', prev ? prev.locationConfidence : '(no prev_geocoding)');
        console.log('  new coords:', p.lat, p.lng, '| ' + p.locationConfidence + '/' + (p.locationSource || '-'));
        console.log('  moved:', moved == null ? 'n/a' : moved + ' m');
        console.log('  strike:', strike);
        console.log('  expected_muni:', muni ? muni.expected_municipality : '-');
    }
}).call({}).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
