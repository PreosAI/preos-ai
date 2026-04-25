const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');

const RESALES_BASE = 'https://webapi.resales-online.com/V6';

function getCorsHeaders(request) {
    const origin = request.headers.get('origin') || '';
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    const corsOrigin = allowed.includes(origin) ? origin : allowed[0] || '';
    return {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
    };
}

app.http('resales-property', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/property/{reference}',
    handler: async (request, context) => {
        const cors = getCorsHeaders(request);

        if (request.method === 'OPTIONS') {
            return { status: 204, headers: cors };
        }

        const p1 = process.env.RESALES_P1;
        const p2 = process.env.RESALES_P2;
        const defaultFilterId = process.env.RESALES_FILTER_ID || '1';
        const reference = request.params.reference;

        if (!p1 || !p2) {
            return {
                status: 503,
                headers: cors,
                jsonBody: { error: 'API credentials not configured' }
            };
        }

        if (!reference) {
            return {
                status: 400,
                headers: cors,
                jsonBody: { error: 'Property reference is required' }
            };
        }

        const upstreamUrl = new URL(RESALES_BASE + '/PropertyDetails');
        upstreamUrl.searchParams.set('p1', p1);
        upstreamUrl.searchParams.set('p2', p2);
        upstreamUrl.searchParams.set('p_agency_filterid', defaultFilterId);
        upstreamUrl.searchParams.set('p_reference', reference);

        const reqUrl = new URL(request.url);
        for (const key of ['p_lang', 'p_dimensionunit', 'p_sandbox', 'p_agency_filterid']) {
            const val = reqUrl.searchParams.get(key);
            if (val) upstreamUrl.searchParams.set(key, val);
        }

        try {
            const fetchOptions = { headers: { 'Accept': 'application/json' } };
            let fetchFn = fetch;
            if (process.env.FIXIE_URL) {
                fetchOptions.dispatcher = new ProxyAgent(process.env.FIXIE_URL);
                fetchFn = undiciFetch;
            }
            const response = await fetchFn(upstreamUrl.toString(), fetchOptions);

            const contentType = response.headers.get('content-type') || '';
            let body;

            if (contentType.includes('application/json')) {
                body = await response.json();
            } else {
                body = await response.text();
            }

            return {
                status: response.status,
                headers: {
                    ...cors,
                    'Content-Type': contentType.includes('json') ? 'application/json' : contentType || 'text/plain',
                    'Cache-Control': 'public, max-age=600'
                },
                ...(typeof body === 'string' ? { body } : { jsonBody: body })
            };
        } catch (err) {
            context.error('Resales API error:', err.message);
            return {
                status: 502,
                headers: cors,
                jsonBody: { error: 'Upstream API error', detail: err.message }
            };
        }
    }
});
