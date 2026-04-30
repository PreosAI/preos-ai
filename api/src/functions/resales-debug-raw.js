const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');

const RESALES_BASE = 'https://webapi.resales-online.com/V6';

// TEMPORARY — Phase 3 investigation. DELETE after capturing data.
app.http('resales-debug-raw', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'resales/debug-raw',
    handler: async (request, context) => {
        const p1 = process.env.RESALES_P1;
        const p2 = process.env.RESALES_P2;
        const filterId = process.env.RESALES_FILTER_ID || '1';
        const endpoint = request.query.get('endpoint') || 'SearchProperties';
        const url = new URL(RESALES_BASE + '/' + endpoint);
        url.searchParams.set('p1', p1);
        url.searchParams.set('p2', p2);
        if (!request.query.has('p_agency_filterid')) {
            url.searchParams.set('p_agency_filterid', filterId);
        }
        const reqUrl = new URL(request.url);
        for (const [k, v] of reqUrl.searchParams) {
            if (k === 'endpoint') continue;
            url.searchParams.set(k, v);
        }
        const fetchOptions = { headers: { 'Accept': 'application/json' } };
        let fetchFn = fetch;
        if (process.env.FIXIE_URL) {
            fetchOptions.dispatcher = new ProxyAgent(process.env.FIXIE_URL);
            fetchFn = undiciFetch;
        }
        try {
            const r = await fetchFn(url.toString(), fetchOptions);
            const ct = r.headers.get('content-type') || '';
            const body = ct.includes('json') ? await r.json() : await r.text();
            return {
                status: r.status,
                jsonBody: typeof body === 'string'
                    ? { upstreamStatus: r.status, contentType: ct, body }
                    : body
            };
        } catch (err) {
            return { status: 502, jsonBody: { error: err.message, cause: err.cause && err.cause.message } };
        }
    }
});
