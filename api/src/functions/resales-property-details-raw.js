// GET /api/resales/property-details-raw?ref={reference}[&lang=1|2|1,2]
//
// Ad-hoc inspection endpoint for the Resales V6 PropertyDetails operation.
// Returns the raw upstream response wrapped in a small envelope. Kept as a
// QA tool for debugging field-level questions.
//
// Routes through Fixie (FIXIE_URL) so the request uses the static IP
// whitelisted with Resales.
//
// No mapping, no caching, no filtering — pure passthrough.

const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');

const RESALES_BASE = 'https://webapi.resales-online.com/V6';

function corsHeaders(request) {
    const origin = request.headers.get('origin') || '';
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    const corsOrigin = allowed.includes(origin) ? origin : allowed[0] || '';
    return {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

app.http('resales-property-details-raw', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/property-details-raw',
    handler: async (request, context) => {
        const cors = corsHeaders(request);
        if (request.method === 'OPTIONS') return { status: 204, headers: cors };

        const ref = (request.query.get('ref') || '').trim();
        if (!ref) {
            return { status: 400, headers: cors, jsonBody: { error: 'ref query param required' } };
        }
        const p1 = process.env.RESALES_P1;
        const p2 = process.env.RESALES_P2;
        if (!p1 || !p2) {
            return { status: 503, headers: cors, jsonBody: { error: 'RESALES_P1/RESALES_P2 not set' } };
        }
        // Resales v6.0.4 multi-language: comma-separated lang codes (1=EN, 2=ES).
        const lang = (request.query.get('lang') || '1,2').trim();

        const upstream = new URL(RESALES_BASE + '/PropertyDetails');
        upstream.searchParams.set('p1', p1);
        upstream.searchParams.set('p2', p2);
        upstream.searchParams.set('P_RefId', ref);
        upstream.searchParams.set('p_Lang', lang);
        // First probe surfaced "FilterId and FilterAgencyId missing" — pass
        // the same filter id used by SearchProperties / sync.
        const filterId = request.query.get('filter') || process.env.RESALES_FILTER_ID || '1';
        upstream.searchParams.set('p_agency_filterid', filterId);
        // Pass through optional flags the caller may want to test with.
        for (const k of ['P_Photos', 'P_RTA', 'P_decree218', 'P_DimensionUnit']) {
            const v = request.query.get(k) || request.query.get(k.toLowerCase());
            if (v) upstream.searchParams.set(k, v);
        }

        const fetchOptions = { headers: { 'Accept': 'application/json' } };
        if (process.env.FIXIE_URL) {
            fetchOptions.dispatcher = new ProxyAgent(process.env.FIXIE_URL);
        }

        const tStart = Date.now();
        let res, bodyText, contentType;
        try {
            res = await undiciFetch(upstream.toString(), fetchOptions);
            contentType = res.headers.get('content-type') || '';
            bodyText = await res.text();
        } catch (err) {
            context.error('PropertyDetails fetch threw:', err.message);
            return {
                status: 502, headers: cors,
                jsonBody: {
                    error: 'upstream fetch failed',
                    detail: err.message,
                    upstream_url: upstream.toString().replace(p2, '<redacted>'),
                    via_fixie: !!process.env.FIXIE_URL
                }
            };
        }

        // Try to parse JSON; if upstream returned HTML/XML/error text just
        // surface it raw so we can see what the issue is (e.g. 401 page).
        let parsed = null;
        try { if (contentType.includes('json') || bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
            parsed = JSON.parse(bodyText);
        }} catch (_) { /* leave as text */ }

        return {
            status: 200, // wrap upstream status in a meta envelope so 401 doesn't fail through
            headers: { ...cors, 'Content-Type': 'application/json' },
            jsonBody: {
                ref,
                lang,
                upstream_status: res.status,
                upstream_url: upstream.toString().replace(p2, '<redacted>'),
                upstream_content_type: contentType,
                via_fixie: !!process.env.FIXIE_URL,
                elapsed_ms: Date.now() - tStart,
                body: parsed != null ? parsed : { raw_text: bodyText.slice(0, 8000) }
            }
        };
    }
});
