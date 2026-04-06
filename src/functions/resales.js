/**
 * resales.js — Resales Online API proxy (Azure Functions v4)
 *
 * Sandbox credentials (public demo — safe to commit):
 *   p1 = 1023133
 *   p2 = f9fe74f5822a04af7e4d5c399e8972474e1c3d15
 *
 * Production credentials: set in Azure Portal →
 * Function App → Settings → Environment variables:
 *   RESALES_P1, RESALES_P2, RESALES_FILTER_ID
 *
 * Endpoint: GET /api/resales?fn=SearchProperties&...
 *           GET /api/resales?fn=PropertyDetails&P_RefId=...
 */

const { app } = require('@azure/functions');
const fetch   = require('node-fetch');

const RESALES_BASE = 'https://webapi.resales-online.com/V6';
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json'
};

app.http('resales', {
  methods:   ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route:     'resales',
  handler:   async (request, context) => {

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: CORS, body: '' };
    }

    const p1       = process.env.RESALES_P1        || '1023133';
    const p2       = process.env.RESALES_P2        || 'f9fe74f5822a04af7e4d5c399e8972474e1c3d15';
    const filterId = process.env.RESALES_FILTER_ID || '1';
    const mode     = process.env.RESALES_MODE      || 'sandbox';

    const incoming = new URL(request.url);
    const qs       = incoming.searchParams;

    const fn = qs.get('fn') || 'SearchProperties';
    if (!['SearchProperties', 'PropertyDetails'].includes(fn)) {
      return {
        status: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'Invalid fn parameter' })
      };
    }

    // Forward all incoming params except 'fn', then inject auth
    const params = new URLSearchParams();
    for (const [k, v] of qs.entries()) {
      if (k !== 'fn') params.set(k, v);
    }
    params.set('p1', p1);
    params.set('p2', p2);
    params.set('p_agency_filterid', params.get('p_agency_filterid') || filterId);
    params.set('p_output', 'JSON');
    if (!params.has('P_PageSize')) params.set('P_PageSize', '100');
    if (!params.has('P_PageNo'))   params.set('P_PageNo',   '1');

    const upstream = `${RESALES_BASE}/${fn}?${params.toString()}`;
    context.log(`Resales proxy → ${fn} (${mode})`);

    try {
      const res  = await fetch(upstream, { timeout: 15000 });
      const data = await res.json();
      if (data.transaction) data.transaction.mode = mode;

      return {
        status:  200,
        headers: CORS,
        body:    JSON.stringify(data)
      };
    } catch (err) {
      context.error('Resales proxy error:', err.message);
      return {
        status:  502,
        headers: CORS,
        body:    JSON.stringify({
          error:  'Upstream Resales API call failed',
          detail: err.message
        })
      };
    }
  }
});
