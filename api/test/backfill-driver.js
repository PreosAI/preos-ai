// Driver for the triangulation backfill. Loops the deployed endpoint with
// cursor pagination until status='complete' or a halt is reported.
//
// Usage:
//   node api/test/backfill-driver.js [--dry-run] [--max-batches=N] [--parallelism=N] [--batchSize=N]
//
// By default writes a per-batch log line to stdout and a summary at the end.
// Persists running totals to api/test/backfill-progress.json so an
// interrupted run can be resumed by inspecting the last cursor.

const fs = require('fs');
const path = require('path');

const ENDPOINT = process.env.TRIANGULATE_ENDPOINT
    || 'https://preos-resales-proxy.azurewebsites.net/api/resales/triangulate-locations';
const PROGRESS_PATH = path.join(__dirname, 'backfill-progress.json');

function parseArgs() {
    const out = { dryRun: false, maxBatches: Infinity, parallelism: 5, batchSize: 80 };
    for (const a of process.argv.slice(2)) {
        if (a === '--dry-run') out.dryRun = true;
        else if (a.startsWith('--max-batches=')) out.maxBatches = parseInt(a.split('=')[1], 10);
        else if (a.startsWith('--parallelism=')) out.parallelism = parseInt(a.split('=')[1], 10);
        else if (a.startsWith('--batchSize=')) out.batchSize = parseInt(a.split('=')[1], 10);
    }
    return out;
}

function loadProgress() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); }
    catch (e) { return { cursor: null, batches: 0, processed: 0, history: [], confidence: {}, strike: {}, totalCost: 0, yearSeed: 0 }; }
}

function saveProgress(p) {
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2));
}

function mergeDist(into, more) {
    for (const [k, v] of Object.entries(more || {})) into[k] = (into[k] || 0) + v;
    return into;
}

(async function main() {
    const args = parseArgs();
    const progress = loadProgress();
    console.log('Endpoint:', ENDPOINT);
    console.log('Resuming from cursor:', progress.cursor || '(start)');
    console.log('Already processed:', progress.processed);

    if (args.dryRun) { console.log('Dry run — no calls.'); return; }

    while (progress.batches < args.maxBatches) {
        const params = new URLSearchParams();
        if (progress.cursor) params.set('startCursor', progress.cursor);
        params.set('batchSize', String(args.batchSize));
        params.set('parallelism', String(args.parallelism));
        const url = ENDPOINT + '?' + params.toString();

        const tBatch = Date.now();
        let res;
        try {
            res = await fetch(url, { method: 'POST' });
        } catch (e) {
            console.log('FETCH ERROR:', e.message, '— sleeping 30s and retrying');
            await new Promise(r => setTimeout(r, 30_000));
            continue;
        }
        const body = await res.json().catch(() => ({ status: 'parse-error' }));
        const batchMs = Date.now() - tBatch;

        if (!res.ok) {
            console.log('HTTP', res.status, 'body:', JSON.stringify(body).slice(0, 200));
            break;
        }

        progress.batches++;
        progress.processed += body.processed || 0;
        progress.cursor = body.nextCursor;
        mergeDist(progress.confidence, body.confidence_distribution);
        mergeDist(progress.strike, body.strike_distribution);
        progress.yearSeed += body.year_seed_count || 0;
        progress.totalCost += (body.tokens && body.tokens.cost_usd) || 0;
        progress.history.push({
            batch: progress.batches,
            processed: body.processed,
            elapsed_ms: body.elapsed_ms,
            wall_ms: batchMs,
            status: body.status,
            cache_stats: body.cache_stats,
            confidence: body.confidence_distribution,
            strike: body.strike_distribution,
            cost_usd: body.tokens && body.tokens.cost_usd
        });
        saveProgress(progress);

        const c = body.confidence_distribution || {};
        const s = body.strike_distribution || {};
        console.log(`[batch ${progress.batches}] processed=${body.processed} (corpus=${progress.processed}) status=${body.status} ${batchMs}ms ` +
            `tiers={ex=${c.exact||0} hi=${c.high||0} md=${c.medium||0} lo=${c.low||0} rj=${c.rejected||0} er=${c.error||0}} ` +
            `strikes={1=${s[1]||0} 2=${s[2]||0} 3=${s[3]||0} rj=${s.rejected||0}} ` +
            `cost=$${(body.tokens && body.tokens.cost_usd) || 0} cum=$${progress.totalCost.toFixed(4)} ` +
            `cache=${body.cache_stats ? 'h='+body.cache_stats.coord_hit+'/m='+body.cache_stats.coord_miss : '-'}`);

        if (body.status === 'complete' || !body.nextCursor) {
            console.log('\nBackfill complete.');
            break;
        }
        if (body.status === 'halted') {
            console.log('\nBackfill halted by endpoint:', body.reason);
            break;
        }
    }

    console.log('\n══ Summary ══');
    console.log('Batches:        ', progress.batches);
    console.log('Processed:      ', progress.processed);
    console.log('Confidence dist:', JSON.stringify(progress.confidence));
    console.log('Strike dist:    ', JSON.stringify(progress.strike));
    console.log('Year seeds:     ', progress.yearSeed);
    console.log('Cumulative cost:', '$' + progress.totalCost.toFixed(4));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
