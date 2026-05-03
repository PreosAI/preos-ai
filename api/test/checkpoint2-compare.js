// Compare v1 / v2 / v3 checkpoint2 results.

const path = require('path');
const fs = require('fs');

const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint2-results-v1.json'), 'utf8'));
const v2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint2-results-v2.json'), 'utf8'));
const v3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'checkpoint2-results.json'), 'utf8'));

function tierOf(r) { return r.error ? 'error' : (r.new_coords && r.new_coords.confidence) || 'unknown'; }

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

function rowMetrics(data) {
    const moves = [];
    let cadGE50 = 0, yearSeed = 0;
    for (const r of data.results) {
        if (r.error) continue;
        if (Number.isFinite(r.moved_m)) moves.push(r.moved_m);
        const cad = r.reasoning_trace && r.reasoning_trace.cadastre_check && r.reasoning_trace.cadastre_check.best_match;
        if (cad && cad.score >= 50) cadGE50++;
        if (r.year && r.year.cadastre_seed && r.year.cadastre_seed.year) yearSeed++;
    }
    return { moves, cadGE50, yearSeed };
}

const m1 = rowMetrics(v1);
const m2 = rowMetrics(v2);
const m3 = rowMetrics(v3);

console.log('Run                 v1                                            v2                                            v3');
console.log('elapsed             ' + v1.elapsed_sec + 's'.padEnd(45) + v2.elapsed_sec + 's'.padEnd(45) + v3.elapsed_sec + 's');
console.log('cost                $' + v1.total_cost_usd_estimate.toString().padEnd(45) + '$' + v2.total_cost_usd_estimate.toString().padEnd(45) + '$' + v3.total_cost_usd_estimate);
console.log('confidence dist     ' + JSON.stringify(v1.confidence_distribution).padEnd(45) + JSON.stringify(v2.confidence_distribution).padEnd(45) + JSON.stringify(v3.confidence_distribution));
console.log();

const b1 = bucket(m1.moves), b2 = bucket(m2.moves), b3 = bucket(m3.moves);
console.log('Move-distance distribution:');
console.log('  bucket        v1   v2   v3');
for (const k of ['0m', '1-100m', '100-500m', '500m-2km', '>2km']) {
    console.log('  ' + k.padEnd(13) + ' ' + String(b1[k] || 0).padStart(2) + '   ' + String(b2[k] || 0).padStart(2) + '   ' + String(b3[k] || 0).padStart(2));
}
console.log();
console.log('Cadastre exact (≥50): v1=' + m1.cadGE50 + '  v2=' + m2.cadGE50 + '  v3=' + m3.cadGE50);
console.log('Cadastre year seed:   v1=' + m1.yearSeed + '  v2=' + m2.yearSeed + '  v3=' + m3.yearSeed);
console.log();

// v2 → v3 transitions (focus)
const v2ById = {};
for (const r of v2.results) v2ById[r.id] = r;

const tierChanges = {};
const sourceChanges = {};
for (const r3 of v3.results) {
    const r2 = v2ById[r3.id];
    if (!r2) continue;
    const k = tierOf(r2) + '→' + tierOf(r3);
    tierChanges[k] = (tierChanges[k] || 0) + 1;
    if (r2.new_coords && r3.new_coords) {
        const sk = (r2.new_coords.source || '') + '→' + (r3.new_coords.source || '').split(' · ')[0];
        sourceChanges[sk] = (sourceChanges[sk] || 0) + 1;
    }
}
console.log('Tier transitions v2 → v3:');
for (const [k, n] of Object.entries(tierChanges).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + k.padEnd(30) + ' ' + n);
}
console.log();
console.log('Source transitions v2 → v3:');
for (const [k, n] of Object.entries(sourceChanges).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + k.padEnd(60) + ' ' + n);
}
console.log();

// Strike distribution for v3
const strikeDist = { 1: 0, 2: 0, 3: 0, none: 0 };
const strikeBySource = {};
for (const r of v3.results) {
    const muni = r.reasoning_trace && r.reasoning_trace.municipality_resolution;
    if (!muni) { strikeDist.none++; continue; }
    const lastStrike = (muni.strikes || []).filter(s => s.matched).pop();
    if (!lastStrike) { strikeDist.none++; continue; }
    strikeDist[lastStrike.strike] = (strikeDist[lastStrike.strike] || 0) + 1;
    const k = 'strike' + lastStrike.strike;
    strikeBySource[k] = (strikeBySource[k] || 0) + 1;
}
console.log('Strike distribution in v3:');
for (const k of [1, 2, 3, 'none']) {
    console.log('  strike ' + k + ': ' + (strikeDist[k] || 0));
}

// The 4 spot-check failures from v2 — what happened in v3?
console.log();
console.log('v2 spot-check WRONG cases — fate in v3:');
const failedIds = ['R5250664', 'R5311879', 'R5353000', 'R5111866'];
for (const id of failedIds) {
    const r2 = v2.results.find(r => r.id === id);
    const r3 = v3.results.find(r => r.id === id);
    if (!r2 || !r3) continue;
    const muni3 = r3.reasoning_trace && r3.reasoning_trace.municipality_resolution;
    const lastStrike = muni3 ? (muni3.strikes || []).filter(s => s.matched).pop() : null;
    console.log('  ' + id + ': v2=' + tierOf(r2) + '/' + (r2.new_coords && r2.new_coords.source) +
        ' → v3=' + tierOf(r3) + '/' + (r3.new_coords && (r3.new_coords.source || '').split(' · ')[0]) +
        ' (strike=' + (lastStrike ? lastStrike.strike : 'none') + ')' +
        '  v2.moved=' + r2.moved_m + 'm  v3.moved=' + r3.moved_m + 'm');
}
