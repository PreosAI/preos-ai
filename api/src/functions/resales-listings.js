// GET /api/resales/listings — LEGACY thin shim.
//
// Returns a flat array of every listing for backward compatibility with index.html,
// favoritos.html, dashboard.html, agente-dashboard.html, mis-ofertas.html, and
// visitas.html — all of which call getAllProperties() and expect an array.
//
// Do NOT extend this endpoint with new features; build them on /listings-paged.
//
// Implementation: raw db.collection('listings').get() (no orderBy / no filters)
// piped through the shared mapToFrontend mapper from ../lib/listings-query so the
// row shape exactly matches /listings-paged. Same shape, same field set, single
// source of truth for mapping. Cached in-memory for 30 min to keep this cheap.
const { app } = require('@azure/functions');
const admin = require('firebase-admin');
const { mapToFrontend } = require('../lib/listings-query');

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

let listingsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

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

app.http('resales-listings', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/listings',
    handler: async (request, context) => {
        const cors = getCorsHeaders(request);
        if (request.method === 'OPTIONS') return { status: 204, headers: cors };

        try {
            const now = Date.now();

            if (!listingsCache || (now - cacheTimestamp > CACHE_TTL_MS)) {
                context.log('Loading listings from Firestore...');
                const snapshot = await getDb().collection('listings').get();
                const rows = [];
                snapshot.forEach(doc => rows.push(mapToFrontend(doc.data())));
                listingsCache = rows;
                cacheTimestamp = now;
                context.log('Cached', listingsCache.length, 'listings');
            } else {
                context.log('Serving from cache,', listingsCache.length, 'listings');
            }

            return {
                status: 200,
                headers: {
                    ...cors,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=600'
                },
                jsonBody: listingsCache
            };
        } catch (err) {
            context.error('Listings error:', err.message);
            return { status: 500, headers: cors, jsonBody: { error: err.message } };
        }
    }
});
