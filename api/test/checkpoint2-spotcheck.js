// Phase A · Checkpoint 2 · Per-property spot-check helper.
//
//   node api/test/checkpoint2-spotcheck.js R166233
//
// Pulls one entry from checkpoint2-results.json and prints a
// human-readable trace plus the listing description so we can manually
// judge ACCURATE / CLOSE / WRONG.

const path = require('path');
const fs = require('fs');

const ID = process.argv[2];
if (!ID) {
    console.error('Usage: node checkpoint2-spotcheck.js <ref>');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint2-results.json'), 'utf8'));
const r = data.results.find(x => x.id === ID);
if (!r) { console.error('Not in results: ' + ID); process.exit(1); }

console.log('══', ID, '──', r.bucket, '══');
console.log('Listing:', JSON.stringify(r.listing, null, 2));
console.log('\nOld coords:', r.old_coords);
console.log('New coords:', r.new_coords);
console.log('Moved:', r.moved_m, 'm');
console.log('\n── Signals extracted by Haiku ──');
console.log(JSON.stringify(r.reasoning_trace.signals_extracted, null, 2));
console.log('\n── Landmarks resolved ──');
console.log(JSON.stringify(r.reasoning_trace.landmarks_resolved, null, 2));
console.log('\n── Cadastre check ──');
console.log(JSON.stringify(r.reasoning_trace.cadastre_check, null, 2));
console.log('\n── Final ──');
console.log('score:', r.reasoning_trace.final_confidence_score);
console.log('reason:', r.reasoning_trace.final_decision_reason);
console.log('\nGoogle Maps lookup:');
console.log('  old: https://www.google.com/maps?q=' + r.old_coords.lat + ',' + r.old_coords.lng);
if (r.new_coords && r.new_coords.lat) {
    console.log('  new: https://www.google.com/maps?q=' + r.new_coords.lat + ',' + r.new_coords.lng);
}
