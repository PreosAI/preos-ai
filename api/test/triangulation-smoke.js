// Anthropic + triangulation smoke test on R166233 (Jubrique villa).
//
// Validates the full pipeline end-to-end on one listing before running on 50.
// Reads ANTHROPIC_API_KEY and MAPBOX_TOKEN from env (set by the caller).

const path = require('path');
const { triangulateLocation } = require(path.join(__dirname, '..', 'src', 'lib', 'location-triangulation.js'));

const LISTINGS_URL = 'https://preos-resales-proxy.azurewebsites.net/api/resales/listings';
const TARGET_REF = process.env.SMOKE_REF || 'R166233';

(async function main() {
    const t0 = Date.now();
    console.log('Fetching listings…');
    const all = await (await fetch(LISTINGS_URL)).json();
    const target = all.find(p => p.id === TARGET_REF);
    if (!target) {
        console.error('No listing found for', TARGET_REF);
        process.exit(1);
    }
    console.log('Target:', target.id, '|', target.type, '|', target.city, '|', target.location);
    console.log('Existing coords:', target.lat, target.lng, '| confidence:', target.locationConfidence);
    console.log('size_m2:', target.size_m2, '| description_es length:', (target.description_es || '').length,
                '| description_en length:', (target.description_en || '').length);

    const result = await triangulateLocation(target, { mapboxToken: process.env.MAPBOX_TOKEN });

    console.log('\n══ Result ══');
    console.log('lat/lng:', result.lat, result.lng);
    console.log('locationConfidence:', result.locationConfidence);
    console.log('locationSource:', result.locationSource);
    console.log('year_built_extracted:', result.year_built_extracted, '/', result.year_built_extracted_confidence);
    console.log('year_built_seed:', JSON.stringify(result.year_built_seed));
    console.log('\n── Signals extracted ──');
    console.log(JSON.stringify(result.reasoning_trace.signals_extracted, null, 2));
    console.log('\n── Landmarks resolved ──');
    console.log(JSON.stringify(result.reasoning_trace.landmarks_resolved, null, 2));
    console.log('\n── Candidates considered ──');
    console.log(JSON.stringify(result.reasoning_trace.candidates_considered, null, 2));
    console.log('\n── Cadastre check ──');
    console.log(JSON.stringify(result.reasoning_trace.cadastre_check, null, 2));
    console.log('\n── Final ──');
    console.log('score:', result.reasoning_trace.final_confidence_score);
    console.log('reason:', result.reasoning_trace.final_decision_reason);
    console.log('\n── Anthropic usage ──');
    console.log(JSON.stringify(result.usage, null, 2));
    console.log('\nElapsed:', ((Date.now() - t0) / 1000).toFixed(1), 's');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
