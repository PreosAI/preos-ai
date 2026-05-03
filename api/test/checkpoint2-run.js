// Phase A · Checkpoint 2 · 50-property triangulation validation.
//
// Picks 10 properties from each of these buckets:
//   - Las Chapas / La Mairena (location IN [...])
//   - Marbella urbanizations (city='Marbella' AND location IN [...])
//   - Estepona (city='Estepona' AND location IN [...])
//   - Mijas Costa (city IN [...])
//   - Random others
//
// Runs triangulateLocation on each, saves results to api/test/checkpoint2-results.json.
// Does NOT touch Firestore listings (per Phase A rules).

const path = require('path');
const fs = require('fs');
const { triangulateLocation, haversineMeters } = require(path.join(__dirname, '..', 'src', 'lib', 'location-triangulation.js'));

const LISTINGS_URL = 'https://preos-resales-proxy.azurewebsites.net/api/resales/listings';
const OUTPUT_PATH = path.join(__dirname, 'checkpoint2-results.json');

// In our dataset the `city` field carries the granular-locality value
// (Resales `Location`), so all buckets filter on that.
const BUCKET_LAS_CHAPAS = ['Las Chapas', 'La Mairena', 'Hacienda Las Chapas', 'Marbesa'];
const BUCKET_MARBELLA_URBS = ['Marbella', 'Nueva Andalucía', 'Puerto Banús', 'The Golden Mile', 'San Pedro de Alcántara'];
const BUCKET_ESTEPONA_LOCS = ['Estepona', 'El Paraiso', 'Atalaya', 'Selwo', 'New Golden Mile', 'Los Flamingos'];
const BUCKET_MIJAS_CITIES = ['Calahonda', 'Riviera del Sol', 'La Cala de Mijas', 'Mijas Costa', 'Mijas'];

function pickN(arr, n, rng) {
    const a = arr.slice();
    const out = [];
    while (a.length && out.length < n) {
        const idx = Math.floor(rng() * a.length);
        out.push(a.splice(idx, 1)[0]);
    }
    return out;
}

// Tiny seeded PRNG so results are reproducible across runs.
function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t = (t + 0x6D2B79F5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function pickFifty(all) {
    const rng = mulberry32(0x50A1FE);
    const filterValid = p => Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
        (p.description_es || p.description_en);

    const lasChapas = all.filter(p => filterValid(p) && BUCKET_LAS_CHAPAS.includes(p.city));
    const marbellaUrbs = all.filter(p => filterValid(p) && BUCKET_MARBELLA_URBS.includes(p.city));
    const estepona = all.filter(p => filterValid(p) && BUCKET_ESTEPONA_LOCS.includes(p.city));
    const mijas = all.filter(p => filterValid(p) && BUCKET_MIJAS_CITIES.includes(p.city));
    const usedIds = new Set();

    const b1 = pickN(lasChapas, 10, rng);
    b1.forEach(p => usedIds.add(p.id));
    const b2 = pickN(marbellaUrbs, 10, rng);
    b2.forEach(p => usedIds.add(p.id));
    const b3 = pickN(estepona, 10, rng);
    b3.forEach(p => usedIds.add(p.id));
    const b4 = pickN(mijas, 10, rng);
    b4.forEach(p => usedIds.add(p.id));

    const others = all.filter(p => filterValid(p) && !usedIds.has(p.id));
    const b5 = pickN(others, 10, rng);

    return [
        { bucket: 'las-chapas-mairena', picks: b1 },
        { bucket: 'marbella-urbs',     picks: b2 },
        { bucket: 'estepona',          picks: b3 },
        { bucket: 'mijas-costa',       picks: b4 },
        { bucket: 'others-random',     picks: b5 }
    ];
}

(async function main() {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.MAPBOX_TOKEN) {
        console.error('ANTHROPIC_API_KEY and MAPBOX_TOKEN must be set');
        process.exit(1);
    }
    const tStart = Date.now();
    console.log('Fetching listings…');
    const all = await (await fetch(LISTINGS_URL)).json();
    console.log('  got', all.length, 'listings');

    const buckets = pickFifty(all);
    let total = 0;
    for (const b of buckets) {
        console.log(' bucket', b.bucket + ':', b.picks.length, 'picked');
        total += b.picks.length;
    }
    if (total < 50) {
        console.log(' WARNING: only', total, 'properties picked across buckets');
    }

    const flat = [];
    for (const b of buckets) for (const p of b.picks) flat.push({ bucket: b.bucket, listing: p });

    const results = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;

    for (let i = 0; i < flat.length; i++) {
        const { bucket, listing } = flat[i];
        const tProp = Date.now();
        process.stdout.write(`[${i + 1}/${flat.length}] ${listing.id} (${bucket}, ${listing.city}/${listing.location}) … `);
        try {
            const r = await triangulateLocation(listing, { mapboxToken: process.env.MAPBOX_TOKEN });
            const movedM = (Number.isFinite(listing.lat) && Number.isFinite(r.lat))
                ? Math.round(haversineMeters(listing.lat, listing.lng, r.lat, r.lng))
                : null;
            const usage = r.usage || {};
            totalInputTokens += usage.input_tokens || 0;
            totalOutputTokens += usage.output_tokens || 0;
            totalCacheRead += usage.cache_read_input_tokens || 0;
            results.push({
                bucket, id: listing.id,
                listing: {
                    type: listing.type, city: listing.city, location: listing.location,
                    neighbourhood: listing.neighbourhood, size_m2: listing.size_m2,
                    bedrooms: listing.bedrooms,
                    description_len: (listing.description_en || listing.description_es || '').length
                },
                old_coords: { lat: listing.lat, lng: listing.lng, confidence: listing.locationConfidence },
                new_coords: { lat: r.lat, lng: r.lng, confidence: r.locationConfidence, source: r.locationSource },
                moved_m: movedM,
                year: {
                    extracted: r.year_built_extracted,
                    extracted_confidence: r.year_built_extracted_confidence,
                    cadastre_seed: r.year_built_seed
                },
                reasoning_trace: r.reasoning_trace,
                usage
            });
            console.log(`${r.locationConfidence}/${r.locationSource} score=${r.reasoning_trace.final_confidence_score} moved=${movedM}m  (${((Date.now() - tProp) / 1000).toFixed(1)}s)`);
        } catch (e) {
            console.log('FAILED:', e.message);
            results.push({ bucket, id: listing.id, error: e.message });
        }
    }

    const elapsedSec = Math.round((Date.now() - tStart) / 1000);
    const totalCostUsd =
        (totalInputTokens / 1_000_000) * 1.0 +
        (totalOutputTokens / 1_000_000) * 5.0; // Haiku 4.5 pricing: $1/M input, $5/M output

    const summary = {
        run_at: new Date().toISOString(),
        elapsed_sec: elapsedSec,
        total_properties: results.length,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_cache_read_tokens: totalCacheRead,
        total_cost_usd_estimate: parseFloat(totalCostUsd.toFixed(4)),
        confidence_distribution: results.reduce((acc, r) => {
            const k = (r.error ? 'error' : (r.new_coords && r.new_coords.confidence) || 'unknown');
            acc[k] = (acc[k] || 0) + 1;
            return acc;
        }, {}),
        results
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));
    console.log('\nSaved', results.length, 'results to', OUTPUT_PATH);
    console.log('Elapsed:', elapsedSec, 's');
    console.log('Tokens: input=' + totalInputTokens, 'output=' + totalOutputTokens, 'cache_read=' + totalCacheRead);
    console.log('Cost estimate: $' + summary.total_cost_usd_estimate);
    console.log('Confidence distribution:', JSON.stringify(summary.confidence_distribution));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
