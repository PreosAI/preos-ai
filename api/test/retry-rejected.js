// Targeted retry on rejected listings — straight loop, no driver shim.

const fs = require('fs');
const path = require('path');

const BASE = 'https://preos-resales-proxy.azurewebsites.net/api/resales/triangulate-locations';
const PROGRESS_PATH = path.join(__dirname, 'retry-progress.json');

function loadProgress() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); }
    catch (_) { return { cursor: null, batches: 0, processed: 0, history: [], confidence: {}, strike: {}, totalCost: 0, yearSeed: 0 }; }
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2)); }
function merge(into, more) { for (const [k,v] of Object.entries(more||{})) into[k] = (into[k]||0)+v; return into; }

(async function main() {
    const progress = loadProgress();
    console.log('Targeted retry on rejected listings');
    console.log('Resuming from cursor:', progress.cursor || '(start)', '   processed so far:', progress.processed);

    while (true) {
        const params = new URLSearchParams();
        params.set('only', 'rejected');
        params.set('batchSize', '80');
        params.set('parallelism', '4');
        if (progress.cursor) params.set('startCursor', progress.cursor);
        const url = BASE + '?' + params.toString();

        const t = Date.now();
        let res;
        try {
            res = await fetch(url, { method: 'POST' });
        } catch (e) {
            console.log('FETCH ERROR:', e.message, '— sleeping 30s and retrying');
            await new Promise(r => setTimeout(r, 30_000));
            continue;
        }
        const body = await res.json().catch(() => ({ status: 'parse-error' }));
        const wall = Date.now() - t;

        if (!res.ok) {
            console.log('HTTP', res.status, JSON.stringify(body).slice(0, 200));
            break;
        }

        progress.batches++;
        progress.processed += body.processed || 0;
        progress.cursor = body.nextCursor;
        merge(progress.confidence, body.confidence_distribution);
        merge(progress.strike, body.strike_distribution);
        progress.yearSeed += body.year_seed_count || 0;
        progress.totalCost += (body.tokens && body.tokens.cost_usd) || 0;
        progress.history.push({
            batch: progress.batches,
            processed: body.processed,
            elapsed_ms: body.elapsed_ms,
            wall_ms: wall,
            status: body.status,
            cache_stats: body.cache_stats,
            confidence: body.confidence_distribution,
            strike: body.strike_distribution,
            cost_usd: body.tokens && body.tokens.cost_usd
        });
        saveProgress(progress);

        const c = body.confidence_distribution || {};
        const s = body.strike_distribution || {};
        console.log(`[batch ${progress.batches}] processed=${body.processed} cum=${progress.processed} status=${body.status} ${wall}ms ` +
            `tiers={ex=${c.exact||0} hi=${c.high||0} md=${c.medium||0} lo=${c.low||0} rj=${c.rejected||0}} ` +
            `strikes={1=${s[1]||0} 2=${s[2]||0} 3=${s[3]||0} rj=${s.rejected||0}} ` +
            `cost=$${(body.tokens && body.tokens.cost_usd)||0} cum=$${progress.totalCost.toFixed(4)}`);

        if (body.status === 'complete' || !body.nextCursor) {
            console.log('\nRetry complete.');
            break;
        }
        if (body.status === 'halted') {
            console.log('\nHalted by endpoint:', body.reason);
            break;
        }
    }

    console.log('\nSummary:');
    console.log('  Batches:        ', progress.batches);
    console.log('  Processed:      ', progress.processed);
    console.log('  Confidence:     ', JSON.stringify(progress.confidence));
    console.log('  Strike:         ', JSON.stringify(progress.strike));
    console.log('  Year seeds:     ', progress.yearSeed);
    console.log('  Cost:           ', '$' + progress.totalCost.toFixed(4));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
