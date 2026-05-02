// TEMPORARY backfill endpoint — re-paginates Resales upstream and rewrites the
// features array on each Firestore listing doc using the new parseFeaturesTree()
// logic. Existing docs only have the legacy flat features array, which cannot be
// reliably reconstructed without the parent category context, so we re-fetch.
//
// Same pagination/timeout pattern as resales-sync.js. Run once per language after
// the mapper refactor deploys, then remove this file in a follow-up commit.
//
// POST /api/resales/backfill-features?lang=es&startPage=1
const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');
const admin = require('firebase-admin');
const { parseFeaturesTree } = require('../lib/features');

let db;
function getDb() {
    if (db) return db;
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 not set');
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    db = admin.firestore();
    return db;
}

const RESALES_BASE = 'https://webapi.resales-online.com/V6';
async function resalesFetch(endpoint, params) {
    const url = new URL(RESALES_BASE + '/' + endpoint);
    url.searchParams.set('p1', process.env.RESALES_P1);
    url.searchParams.set('p2', process.env.RESALES_P2);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const fetchOptions = { headers: { 'Accept': 'application/json' } };
    if (process.env.FIXIE_URL) fetchOptions.dispatcher = new ProxyAgent(process.env.FIXIE_URL);
    const res = await undiciFetch(url.toString(), fetchOptions);
    return res.json();
}

app.http('resales-backfill-features', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'resales/backfill-features',
    handler: async (request, context) => {
        const p1 = process.env.RESALES_P1;
        const p2 = process.env.RESALES_P2;
        if (!p1 || !p2) {
            return { status: 503, jsonBody: { error: 'API credentials not configured' } };
        }

        const startPage = parseInt(request.query.get('startPage') || '1');
        const filterAlias = request.query.get('filter') || process.env.RESALES_FILTER_ID || '1';
        // Always English: Resales translates Category Type/Value names per p_lang.
        // Parsing on a Spanish run would store "posicion_*"/"aparcamiento_*" prefixes
        // that don't match the English filter terms the frontend uses.
        const pLang = '1';
        const pageSize = 40;
        const startTime = Date.now();
        const MAX_RUNTIME_MS = 150 * 1000;
        let page = startPage;
        let totalUpdated = 0;
        let stoppedEarly = false;
        const samples = []; // first few transformed features arrays for verification

        try {
            const db = getDb();

            while (true) {
                if (Date.now() - startTime > MAX_RUNTIME_MS) {
                    context.log('Approaching timeout, stopping at page', page);
                    stoppedEarly = true;
                    break;
                }

                context.log('Backfill page', page);
                const data = await resalesFetch('SearchProperties', {
                    p_agency_filterid: filterAlias,
                    p_PageSize: String(pageSize),
                    p_PageNo: String(page),
                    p_lang: pLang,
                });

                if (data.transaction && data.transaction.status === 'error') {
                    context.error('API error:', JSON.stringify(data.transaction));
                    break;
                }
                if (!data.Property || data.Property.length === 0) {
                    context.log('No more properties at page', page);
                    break;
                }

                const batch = db.batch();
                let batched = 0;
                for (const p of data.Property) {
                    const ref = p.Reference;
                    if (!ref) continue;
                    const features = parseFeaturesTree(p.PropertyFeatures);
                    if (samples.length < 3) {
                        samples.push({ reference: ref, features });
                    }
                    batch.set(db.collection('listings').doc(ref), { features }, { merge: true });
                    batched++;
                }
                if (batched > 0) await batch.commit();
                totalUpdated += batched;
                context.log('Page', page, 'wrote', batched, 'docs.', totalUpdated, 'total');

                page++;
                await new Promise(r => setTimeout(r, 300));
            }

            return {
                status: 200,
                jsonBody: {
                    status: stoppedEarly ? 'partial' : 'complete',
                    totalUpdated,
                    lastPage: page - 1,
                    nextPage: stoppedEarly ? page : null,
                    samples,
                    message: stoppedEarly
                        ? 'Stopped early due to timeout. Run again with ?startPage=' + page
                        : 'Backfill complete'
                }
            };
        } catch (err) {
            context.error('Backfill error:', err.message, err.stack);
            return {
                status: 500,
                jsonBody: { error: 'Backfill failed', detail: err.message, lastPage: page, totalUpdated }
            };
        }
    }
});
