// Compare v1 (pre-fix) vs v2 (post-fix) checkpoint2 results.

const path = require('path');
const fs = require('fs');

const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint2-results-v1.json'), 'utf8'));
const v2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint2-results.json'), 'utf8'));

function tierOf(r) { return r.error ? 'error' : (r.new_coords && r.new_coords.confidence) || 'unknown'; }

console.log('Run                  v1                                            v2');
console.log('elapsed              ' + v1.elapsed_sec + 's'.padEnd(45) + v2.elapsed_sec + 's');
console.log('cost                 $' + v1.total_cost_usd_estimate.toString().padEnd(45) + '$' + v2.total_cost_usd_estimate);
console.log('confidence dist      ' + JSON.stringify(v1.confidence_distribution).padEnd(45) + JSON.stringify(v2.confidence_distribution));
console.log();

const v1ById = {};
for (const r of v1.results) v1ById[r.id] = r;

const moves = { v1: [], v2: [] };
const tierChanges = {};
const sourceChanges = {};
let cadV1 = 0, cadV2 = 0;
let yearV1 = 0, yearV2 = 0;
const movedLess = [];

for (const r2 of v2.results) {
    const r1 = v1ById[r2.id];
    if (!r1) continue;
    const t1 = tierOf(r1), t2 = tierOf(r2);
    const k = t1 + '→' + t2;
    tierChanges[k] = (tierChanges[k] || 0) + 1;
    if (r1.new_coords && r2.new_coords) {
        const sk = (r1.new_coords.source || '') + '→' + (r2.new_coords.source || '');
        sourceChanges[sk] = (sourceChanges[sk] || 0) + 1;
    }
    if (Number.isFinite(r1.moved_m)) moves.v1.push(r1.moved_m);
    if (Number.isFinite(r2.moved_m)) moves.v2.push(r2.moved_m);
    const cad1 = r1.reasoning_trace && r1.reasoning_trace.cadastre_check && r1.reasoning_trace.cadastre_check.best_match;
    const cad2 = r2.reasoning_trace && r2.reasoning_trace.cadastre_check && r2.reasoning_trace.cadastre_check.best_match;
    if (cad1 && cad1.score >= 50) cadV1++;
    if (cad2 && cad2.score >= 50) cadV2++;
    if (r1.year && r1.year.cadastre_seed && r1.year.cadastre_seed.year) yearV1++;
    if (r2.year && r2.year.cadastre_seed && r2.year.cadastre_seed.year) yearV2++;

    if (Number.isFinite(r1.moved_m) && Number.isFinite(r2.moved_m) && r1.moved_m > 5000) {
        movedLess.push({ id: r2.id, city: r2.listing.city, v1Move: r1.moved_m, v2Move: r2.moved_m });
    }
}

function bucket(arr) {
    const b = { '0m': 0, '1-100m': 0, '100-500m': 0, '500m-2km': 0, '>2km': 0 };
    for (const m of arr) {
        if (m === 0) b['0m']++;
        else if (m <= 100) b['1-100m']++;
        else if (m <= 500) b['100-500m']++;
        else if (m <= 2000) b['500m-2km']++;
        else b['>2km']++;
    }
    return b;
}

const m1 = bucket(moves.v1);
const m2 = bucket(moves.v2);
console.log('Move-distance distribution:');
console.log('  bucket       v1   v2');
for (const k of ['0m', '1-100m', '100-500m', '500m-2km', '>2km']) {
    console.log('  ' + k.padEnd(12) + ' ' + String(m1[k] || 0).padStart(2) + '   ' + String(m2[k] || 0).padStart(2));
}
console.log();

console.log('Tier transitions (v1 → v2):');
for (const [k, n] of Object.entries(tierChanges).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + k.padEnd(30) + ' ' + n);
}
console.log();

console.log('Source transitions (v1 → v2):');
for (const [k, n] of Object.entries(sourceChanges).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + k.padEnd(60) + ' ' + n);
}
console.log();

console.log('Cadastre exact matches (score≥50): v1=' + cadV1 + '  v2=' + cadV2);
console.log('Cadastre year seed found:          v1=' + yearV1 + '  v2=' + yearV2);
console.log();

console.log('Properties that moved >5km in v1 — what happened in v2?');
for (const x of movedLess.sort((a, b) => b.v1Move - a.v1Move)) {
    console.log('  ' + x.id + ' (' + x.city + '): v1 ' + x.v1Move + 'm → v2 ' + x.v2Move + 'm');
}
