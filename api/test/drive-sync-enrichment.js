// Drive the resales-sync endpoint to completion. Each invocation processes
// one Function App slice (~200 properties / 200 s) then returns nextPage.
// Loop until status='complete' or error.

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://preos-resales-proxy.azurewebsites.net/api/resales/sync';
const PROGRESS_PATH = path.join(__dirname, 'sync-enrichment-progress.json');

function load() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); }
    catch (_) { return { invocations: 0, page: 1, totalSynced: 0, totalEnriched: 0, totalSkipped: 0, history: [] }; }
}
function save(p) { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2)); }

(async function main() {
    const lang = process.env.SYNC_LANG || 'en';
    const progress = load();
    console.log('Resuming from page', progress.page, '— totalSynced=' + progress.totalSynced);
    const tStart = Date.now();

    while (true) {
        const url = ENDPOINT + '?lang=' + lang + '&startPage=' + progress.page;
        const t = Date.now();
        let res, body;
        try {
            res = await fetch(url, { method: 'POST' });
            body = await res.json();
        } catch (e) {
            console.log('FETCH ERROR:', e.message, '— sleeping 30s');
            await new Promise(r => setTimeout(r, 30_000));
            continue;
        }
        const wall = Date.now() - t;

        progress.invocations++;
        progress.totalSynced = body.totalSynced || progress.totalSynced;
        progress.totalEnriched = (progress.totalEnriched || 0) + (body.enrichedCount || 0);
        progress.totalSkipped = (progress.totalSkipped || 0) + (body.enrichmentSkippedCount || 0);
        progress.history.push({
            invocation: progress.invocations,
            startPage: progress.page,
            lastPage: body.lastPage,
            nextPage: body.nextPage,
            status: body.status,
            wall_ms: wall,
            enrichedCount: body.enrichedCount,
            skipped: body.enrichmentSkippedCount,
            err: !res.ok ? (body.error || res.status) : undefined
        });

        if (!res.ok) {
            // Transient 500 ("fetch failed" / network blip on Resales side):
            // retry up to 3 times with backoff before giving up.
            const detail = String((body && body.detail) || '');
            const transient = res.status >= 500 &&
                (/fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN/.test(detail) ||
                 detail === '');
            const attempt = (progress._consecutiveTransientFailures || 0) + 1;
            if (transient && attempt <= 3) {
                const backoff = Math.min(60000, 5000 * Math.pow(2, attempt - 1));
                progress._consecutiveTransientFailures = attempt;
                console.log('HTTP', res.status, '(transient, attempt ' + attempt + '/3) — retrying in ' +
                    Math.round(backoff / 1000) + 's. detail:', detail.slice(0, 120));
                save(progress);
                await new Promise(r => setTimeout(r, backoff));
                continue; // retry without advancing page
            }
            console.log('HTTP', res.status, 'body:', JSON.stringify(body).slice(0, 300));
            save(progress);
            break;
        }
        progress._consecutiveTransientFailures = 0;

        console.log('[inv ' + progress.invocations + '] pages ' + progress.page + '..' + body.lastPage +
            '  status=' + body.status + '  enriched=' + body.enrichedCount +
            '  skipped=' + body.enrichmentSkippedCount + '  ' + Math.round(wall / 1000) + 's wall' +
            '  cumulative=' + progress.totalSynced + '/' + (body.totalProperties || '?'));

        if (body.status === 'complete' || !body.nextPage) {
            console.log('\nSync complete.');
            save(progress);
            break;
        }
        progress.page = body.nextPage;
        save(progress);
    }

    const elapsedMin = ((Date.now() - tStart) / 60000).toFixed(1);
    console.log('\nSummary:');
    console.log('  invocations:', progress.invocations);
    console.log('  totalSynced:', progress.totalSynced);
    console.log('  totalEnriched:', progress.totalEnriched);
    console.log('  totalSkipped:', progress.totalSkipped);
    console.log('  wall:', elapsedMin, 'min');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
