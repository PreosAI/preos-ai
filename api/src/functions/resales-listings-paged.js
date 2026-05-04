// GET /api/resales/listings-paged — server-side filtered + cursor paginated.
//
// Query params:
//   city            — exact match on `location` field (more specific than `area`)
//   propertyType    — normalized type (Apartamento|Villa|Adosado|Ático|Solar|Local).
//                     Filtered in-memory because the stored `propertyType` is the raw Resales
//                     NameType (e.g. "Apartment - Penthouse"), not the normalized form.
//   minPrice, maxPrice — inclusive range on `price`
//   minBedrooms     — `>=` on `bedrooms`
//   features        — comma-separated normalized features; filtered in-memory.
//   cursor          — doc id to start after (resolved via one extra read).
//   limit           — 1..100, default 50.
//   sort            — quality (default) | price_asc | price_desc.
//   lang            — es|en (informational; both descriptions are always returned).
//
// Cache: 5 min, keyed by canonicalised query string.
// Query implementation lives in ../lib/listings-query.js (also used by the legacy shim).
const { app } = require('@azure/functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { queryListings } = require('../lib/listings-query');

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

const cache = new Map(); // key → { value, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
    const e = cache.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { cache.delete(key); return null; }
    return e.value;
}
function cacheSet(key, value) {
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

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

function parsePositiveInt(v, fallback) {
    if (v == null || v === '') return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function buildCacheKey(params) {
    const keys = Object.keys(params).filter(k => params[k] != null && params[k] !== '').sort();
    const canon = keys.map(k => k + '=' + params[k]).join('&');
    return crypto.createHash('sha1').update(canon).digest('hex');
}

app.http('resales-listings-paged', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/listings-paged',
    handler: async (request, context) => {
        const cors = getCorsHeaders(request);
        if (request.method === 'OPTIONS') return { status: 204, headers: cors };

        try {
            const q = request.query;
            const city = (q.get('city') || '').trim();
            const propertyType = (q.get('propertyType') || '').trim();
            const minPrice = parsePositiveInt(q.get('minPrice'), null);
            const maxPrice = parsePositiveInt(q.get('maxPrice'), null);
            const minBedrooms = parsePositiveInt(q.get('minBedrooms'), null);
            const featuresParam = (q.get('features') || '').trim();
            const features = featuresParam ? featuresParam.split(',').map(s => s.trim()).filter(Boolean) : [];
            const cursor = (q.get('cursor') || '').trim();
            const limit = Math.max(1, Math.min(100, parsePositiveInt(q.get('limit'), 50)));
            const sortRaw = (q.get('sort') || 'quality').trim();
            const sort = ['quality', 'price_asc', 'price_desc'].includes(sortRaw) ? sortRaw : 'quality';
            const langRaw = (q.get('lang') || 'es').toLowerCase();
            const lang = langRaw === 'en' ? 'en' : 'es';
            const confidenceRaw = (q.get('confidence') || '').trim().toLowerCase();
            const confidence = ['exact', 'high', 'medium', 'low', 'rejected'].includes(confidenceRaw)
                ? confidenceRaw : '';

            const cacheKey = buildCacheKey({ city, propertyType, minPrice, maxPrice, minBedrooms,
                features: features.join(','), confidence, cursor, limit, sort, lang });
            const cached = cacheGet(cacheKey);
            if (cached) {
                context.log('Cache hit:', cacheKey);
                return {
                    status: 200,
                    headers: { ...cors, 'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=300', 'X-Cache': 'HIT' },
                    jsonBody: cached
                };
            }

            const body = await queryListings(getDb(), {
                city, propertyType, minPrice, maxPrice, minBedrooms,
                features, confidence, cursor, limit, sort
            }, context);

            cacheSet(cacheKey, body);

            return {
                status: 200,
                headers: { ...cors, 'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=300', 'X-Cache': 'MISS' },
                jsonBody: body
            };
        } catch (err) {
            context.error('listings-paged error:', err.message, err.stack);
            return { status: 500, headers: cors, jsonBody: { error: err.message } };
        }
    }
});
