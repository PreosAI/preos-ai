// Phase A · Checkpoint 2 · Analysis helper.
//
// Reads api/test/checkpoint2-results.json, prints:
//   1. Per-bucket confidence distribution.
//   2. Cadastre conversion: how many reached 'exact', score histogram.
//   3. Move distance distribution (cold vs warm coords).
//   4. Year-extracted distribution.
//   5. 10 spot-check entries (2 exact / 3 high / 3 medium / 1 low / 1 rejected,
//      best-effort given the actual distribution).
//   6. Concise per-property summary table.

const path = require('path');
const fs = require('fs');

const INPUT = path.join(__dirname, 'checkpoint2-results.json');

function pct(n, d) { return d ? ((n / d) * 100).toFixed(1) + '%' : '0%'; }

(function main() {
    const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
    const results = data.results;
    const total = results.length;
    console.log('Phase A · Checkpoint 2 · 50-property triangulation analysis');
    console.log('Run at', data.run_at, '· elapsed', data.elapsed_sec + 's', '· cost ~$' + data.total_cost_usd_estimate);
    console.log('Tokens: input=' + data.total_input_tokens, 'output=' + data.total_output_tokens, 'cache_read=' + data.total_cache_read_tokens);
    console.log('Total properties:', total);
    console.log();

    // 1. Confidence distribution
    console.log('── Confidence distribution ──');
    const tiers = ['exact', 'high', 'medium', 'low', 'rejected', 'error'];
    for (const t of tiers) {
        const n = (data.confidence_distribution[t] || 0);
        if (n) console.log('  ' + t + ': ' + n + ' (' + pct(n, total) + ')');
    }

    // 2. Per-bucket
    console.log('\n── Per-bucket distribution ──');
    const byBucket = {};
    for (const r of results) {
        const b = r.bucket;
        const tier = r.error ? 'error' : (r.new_coords && r.new_coords.confidence) || 'unknown';
        if (!byBucket[b]) byBucket[b] = {};
        byBucket[b][tier] = (byBucket[b][tier] || 0) + 1;
        byBucket[b]._n = (byBucket[b]._n || 0) + 1;
    }
    for (const [b, dist] of Object.entries(byBucket)) {
        const parts = Object.entries(dist).filter(([k]) => k !== '_n').map(([k, v]) => k + '=' + v).join(' ');
        console.log('  ' + b.padEnd(22) + ' n=' + dist._n + '  ' + parts);
    }

    // 3. Cadastre conversion
    console.log('\n── Cadastre conversion ──');
    let cadastreAttempted = 0, cadastreParcelsReturned = 0, cadastreScoreGE50 = 0, cadastreScore30to49 = 0;
    let yearSeedFromCadastre = 0;
    const m2DiffSamples = [];
    for (const r of results) {
        if (r.error) continue;
        const cad = r.reasoning_trace && r.reasoning_trace.cadastre_check;
        if (cad && !cad.error) {
            cadastreAttempted++;
            if (cad.parcels_returned > 0) cadastreParcelsReturned++;
            const bm = cad.best_match;
            if (bm && bm.score >= 50) cadastreScoreGE50++;
            if (bm && bm.score >= 30 && bm.score < 50) cadastreScore30to49++;
            if (bm && bm.breakdown && bm.breakdown.m2 && Number.isFinite(bm.breakdown.m2.pctDiff)) {
                m2DiffSamples.push(bm.breakdown.m2.pctDiff);
            }
        }
        if (r.year && r.year.cadastre_seed && r.year.cadastre_seed.year) yearSeedFromCadastre++;
    }
    console.log('  attempted:                ' + cadastreAttempted + '/' + total);
    console.log('  returned ≥1 parcel:       ' + cadastreParcelsReturned);
    console.log('  match score ≥ 50 (exact): ' + cadastreScoreGE50);
    console.log('  match score 30-49:        ' + cadastreScore30to49);
    console.log('  cadastre year seed found: ' + yearSeedFromCadastre);
    if (m2DiffSamples.length) {
        const sorted = m2DiffSamples.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        console.log('  m² pct-diff: median=' + (median * 100).toFixed(1) + '%, mean=' + (mean * 100).toFixed(1) + '% (n=' + sorted.length + ')');
    }

    // 4. Move distance
    console.log('\n── Move distance (new vs old coords) ──');
    const moves = results.filter(r => Number.isFinite(r.moved_m)).map(r => r.moved_m);
    if (moves.length) {
        const sorted = moves.slice().sort((a, b) => a - b);
        const buckets = { '0m': 0, '1-100m': 0, '100-500m': 0, '500m-2km': 0, '>2km': 0 };
        for (const m of moves) {
            if (m === 0) buckets['0m']++;
            else if (m <= 100) buckets['1-100m']++;
            else if (m <= 500) buckets['100-500m']++;
            else if (m <= 2000) buckets['500m-2km']++;
            else buckets['>2km']++;
        }
        for (const [k, v] of Object.entries(buckets)) console.log('  ' + k.padEnd(12) + ' ' + v);
        console.log('  median=' + sorted[Math.floor(sorted.length / 2)] + 'm,  max=' + sorted[sorted.length - 1] + 'm');
    }

    // 5. Year extraction
    console.log('\n── Year-built extraction ──');
    let yExtracted = 0, yExplicit = 0, yInferred = 0, yRenovated = 0;
    for (const r of results) {
        if (r.error) continue;
        const ye = r.year && r.year.extracted;
        const yc = r.year && r.year.extracted_confidence;
        if (ye) {
            yExtracted++;
            if (yc === 'explicit') yExplicit++;
            else if (yc === 'inferred') yInferred++;
            else if (yc === 'renovated') yRenovated++;
        }
    }
    console.log('  extracted from description:  ' + yExtracted);
    console.log('    explicit:  ' + yExplicit);
    console.log('    inferred:  ' + yInferred);
    console.log('    renovated: ' + yRenovated);

    // 6. Spot-check selection
    console.log('\n── Spot-check picks (10) ──');
    const wantedDist = { exact: 2, high: 3, medium: 3, low: 1, rejected: 1 };
    const picks = [];
    for (const tier of Object.keys(wantedDist)) {
        const matching = results.filter(r => !r.error && r.new_coords && r.new_coords.confidence === tier);
        const need = wantedDist[tier];
        for (let i = 0; i < Math.min(need, matching.length); i++) {
            picks.push(matching[i]);
        }
    }
    while (picks.length < 10) {
        // top up with anything else
        const remaining = results.filter(r => !r.error && !picks.includes(r));
        if (remaining.length === 0) break;
        picks.push(remaining[0]);
    }
    for (const p of picks.slice(0, 10)) {
        const cad = p.reasoning_trace && p.reasoning_trace.cadastre_check;
        const cadAddr = cad && cad.closest_parcel ? cad.closest_parcel.address : '';
        console.log('  [' + p.new_coords.confidence + '] ' + p.id + ' | ' + p.listing.city +
            ' | moved ' + p.moved_m + 'm | source=' + p.new_coords.source +
            ' | cadastre=' + cadAddr.slice(0, 60));
    }

    // 7. Per-property summary table
    console.log('\n── Per-property summary ──');
    console.log('id        bucket               city                     tier      source                       moved   cadScore  refcat');
    for (const r of results) {
        if (r.error) {
            console.log(r.id.padEnd(10) + ' ' + r.bucket.padEnd(20) + ' ERROR: ' + r.error);
            continue;
        }
        const cad = r.reasoning_trace && r.reasoning_trace.cadastre_check;
        const bm = cad && cad.best_match;
        console.log(
            r.id.padEnd(10) + ' ' +
            r.bucket.padEnd(20) + ' ' +
            (r.listing.city || '').slice(0, 24).padEnd(24) + ' ' +
            r.new_coords.confidence.padEnd(9) + ' ' +
            r.new_coords.source.padEnd(28) + ' ' +
            String(r.moved_m).padStart(5) + 'm  ' +
            String(bm ? bm.score : '-').padStart(7) + '  ' +
            (bm ? bm.refcat : '-')
        );
    }
})();
