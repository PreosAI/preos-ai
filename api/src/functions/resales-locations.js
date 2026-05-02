// GET /api/resales/locations — aggregated location index for autocomplete.
//
// Scans the listings collection and returns:
//   { provinces: [...], cities: [...], areas: [...], neighbourhoods: [...] }
// Each entry: { name, normName, count }
//
// Data shape mirrors window._suggestIndex used by getSuggestions() in
// frontend/js/properties.js, but sourced from a lightweight aggregation
// instead of the full listings cache. Order is descending by count, then
// name asc, so prefix-match in the client lands on the most populated
// entries first.
//
// Cache: 1 hour TTL — locations change very slowly.
const { app } = require('@azure/functions');
const admin = require('firebase-admin');

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

let cached = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function toEntries(map) {
    const arr = [];
    map.forEach((count, name) => arr.push({ name, normName: norm(name), count }));
    arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return arr;
}

app.http('resales-locations', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/locations',
    handler: async (request, context) => {
        const cors = getCorsHeaders(request);
        if (request.method === 'OPTIONS') return { status: 204, headers: cors };

        try {
            const now = Date.now();
            if (cached && now < cacheExpiresAt) {
                return {
                    status: 200,
                    headers: { ...cors, 'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' },
                    jsonBody: cached
                };
            }

            const db = getDb();
            // Project only the fields we aggregate on — keeps payload small even on a full scan.
            const t0 = Date.now();
            const snap = await db.collection('listings')
                .select('province', 'location', 'area', 'subLocation').get();
            context.log('locations: scanned', snap.size, 'docs in', Date.now() - t0, 'ms');

            const provinces = new Map();
            const cities = new Map();
            const areas = new Map();
            const neighbourhoods = new Map();

            snap.forEach(doc => {
                const d = doc.data();
                if (d.province) provinces.set(d.province, (provinces.get(d.province) || 0) + 1);
                if (d.location) cities.set(d.location, (cities.get(d.location) || 0) + 1);
                if (d.area) areas.set(d.area, (areas.get(d.area) || 0) + 1);
                if (d.subLocation && d.subLocation !== d.location) {
                    neighbourhoods.set(d.subLocation,
                        (neighbourhoods.get(d.subLocation) || 0) + 1);
                }
            });

            const body = {
                provinces:      toEntries(provinces),
                cities:         toEntries(cities),
                areas:          toEntries(areas),
                neighbourhoods: toEntries(neighbourhoods),
                generatedAt:    new Date().toISOString(),
                source:         'listings'
            };

            cached = body;
            cacheExpiresAt = now + CACHE_TTL_MS;

            return {
                status: 200,
                headers: { ...cors, 'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' },
                jsonBody: body
            };
        } catch (err) {
            context.error('locations error:', err.message, err.stack);
            return { status: 500, headers: cors, jsonBody: { error: err.message } };
        }
    }
});
