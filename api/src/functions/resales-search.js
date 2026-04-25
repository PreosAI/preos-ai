const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');

const RESALES_BASE = 'https://webapi.resales-online.com/V6';

const ALLOWED_PARAMS = new Set([
    'p_agency_filterid', 'p_apikey', 'p_sandbox', 'p_lang',
    'p_country', 'p_province', 'p_area', 'p_location',
    'p_bedrooms', 'p_minbedrooms', 'p_maxbedrooms',
    'p_type', 'p_subtype', 'p_minprice', 'p_maxprice',
    'p_currency', 'p_features', 'p_pool', 'p_parking',
    'p_garden', 'p_pagesize', 'p_pagenumber',
    'p_sorttype', 'p_sort', 'p_own', 'p_new', 'p_newdev',
    'p_reference', 'p_dimensionunit', 'p_RTA',
    'p_decree218', 'p_photos'
]);

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

app.http('resales-search', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/search',
    handler: async (request, context) => {
        const cors = getCorsHeaders(request);

        if (request.method === 'OPTIONS') {
            return { status: 204, headers: cors };
        }

        const p1 = process.env.RESALES_P1;
        const p2 = process.env.RESALES_P2;
        const defaultFilterId = process.env.RESALES_FILTER_ID || '1';

        if (!p1 || !p2) {
            return {
                status: 503,
                headers: cors,
                jsonBody: { error: 'API credentials not configured' }
            };
        }

        const upstreamUrl = new URL(RESALES_BASE + '/SearchProperties');
        upstreamUrl.searchParams.set('p1', p1);
        upstreamUrl.searchParams.set('p2', p2);

        const reqUrl = new URL(request.url);
        for (const [key, value] of reqUrl.searchParams) {
            if (ALLOWED_PARAMS.has(key.toLowerCase()) || ALLOWED_PARAMS.has(key)) {
                upstreamUrl.searchParams.set(key, value);
            }
        }

        if (!upstreamUrl.searchParams.has('p_agency_filterid')) {
            upstreamUrl.searchParams.set('p_agency_filterid', defaultFilterId);
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
                    'Cache-Control': 'public, max-age=300'
                },
                ...(typeof body === 'string' ? { body } : { jsonBody: body })
            };
        } catch (err) {
            context.error('Resales API error:', err.message, err.cause);
            return {
                status: 502,
                headers: cors,
                jsonBody: { error: 'Upstream API error', detail: err.message, cause: err.cause ? err.cause.message : null, stack: err.stack }
            };
        }
    }
});
