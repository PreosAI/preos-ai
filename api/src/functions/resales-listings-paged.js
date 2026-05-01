// GET /api/resales/listings-paged — server-side filtered + cursor paginated.
//
// Query params:
//   city            — exact match on `location` field (more specific than `area`)
//   propertyType    — normalized type (Apartamento|Villa|Adosado|Ático|Solar|Local).
//                     Filtered in-memory because the stored `propertyType` is the raw Resales
//                     NameType (e.g. "Apartment - Penthouse"), not the normalized form. A future
//                     backfill could add a `normalizedType` field to make this server-side.
//   minPrice, maxPrice — inclusive range on `price`
//   minBedrooms     — `>=` on `bedrooms`
//   features        — comma-separated normalized features; filtered in-memory (array fields are
//                     poorly indexed for AND-of-multiple).
//   cursor          — doc id to start after (resolved via one extra read into a DocumentSnapshot)
//   limit           — 1..100, default 50
//   sort            — quality (default) | price_asc | price_desc
//   lang            — es|en, default es. Currently informational; both description_es and
//                     description_en are always returned in the mapped object.
//
// Composite indexes likely needed (auto-create on first miss):
//   1. listings (location, quality_score desc)
//   2. listings (price asc, quality_score desc)
//   3. listings (location, price asc)
//   4. listings (bedrooms asc, quality_score desc)
//   5. listings (location, bedrooms asc, quality_score desc)
//   6. listings (price asc, bedrooms asc, quality_score desc)  // multi-range + quality sort
// Firestore returns a console link in the error when an index is missing.
//
// Cache: 5 min, keyed by canonicalised query string.
const { app } = require('@azure/functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

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

function computeQualityScore(d) {
    const conf = d.locationConfidence;
    const confPts = conf === 'high' ? 40 : conf === 'medium' ? 20 : 0;
    const imgPts = Math.min(d.imageCount || (d.images ? d.images.length : 0), 10) * 3;
    const bedPts = (d.bedrooms || 0) > 0 ? 15 : 0;
    const price = d.price || 0;
    const pricePts = (price >= 50000 && price <= 5000000) ? 15 : 0;
    return confPts + imgPts + bedPts + pricePts;
}

function normalizeType(type, sub) {
    const t = ((type || '') + ' ' + (sub || '')).toLowerCase();
    if (t.indexOf('apartment') > -1 || t.indexOf('flat') > -1 || t.indexOf('studio') > -1) return 'Apartamento';
    if (t.indexOf('villa') > -1 || t.indexOf('chalet') > -1 || t.indexOf('house') > -1 || t.indexOf('casa') > -1) return 'Villa';
    if (t.indexOf('townhouse') > -1 || t.indexOf('semi') > -1) return 'Adosado';
    if (t.indexOf('penthouse') > -1) return 'Ático';
    if (t.indexOf('plot') > -1 || t.indexOf('land') > -1) return 'Solar';
    if (t.indexOf('commercial') > -1) return 'Local';
    return type || 'Propiedad';
}

const FEATURE_MAP = {
    'Pool': 'pool',
    'Garden': 'garden',
    'Parking': 'garage', 'Garage': 'garage',
    'Air Conditioning': 'air_conditioning',
    'Elevator': 'elevator', 'Lift': 'elevator',
    'Sea': 'sea_views', 'Sea Views': 'sea_views',
    'Beachfront': 'beachfront', 'Beach': 'beachfront', 'Beachside': 'beachfront',
    'Home Automation': 'home_automation', 'Domotica': 'home_automation', 'Domótica': 'home_automation',
    'Terrace': 'terrace', 'Private Terrace': 'terrace', 'Covered Terrace': 'terrace',
};

function mapToFrontend(d) {
    const type = d.propertyType || 'Propiedad';
    const sub = d.subtype || '';
    const normalizedType = normalizeType(type, sub);
    const beds = d.bedrooms || 0;
    const loc = d.location || d.area || '';

    return {
        id: d.reference,
        title: (beds > 0 ? beds + ' hab. ' : '') + normalizedType + (loc ? ' en ' + loc : ''),
        title_en: (beds > 0 ? beds + '-bed ' : '') + normalizedType + (loc ? ' in ' + loc : ''),
        price: d.price || 0,
        bedrooms: d.bedrooms || 0,
        bathrooms: d.bathrooms || 0,
        size_m2: d.built || null,
        plot_m2: d.gardenPlot || null,
        terrace_m2: d.terrace || null,
        location: [d.subLocation, d.location, d.area].filter(Boolean).join(', '),
        city: d.location || '',
        area: d.area || '',
        neighbourhood: d.subLocation || '',
        province: d.province || 'Málaga',
        lat: d.lat || null,
        lng: d.lng || null,
        locationConfidence: d.locationConfidence || 'none',
        type: normalizedType,
        subtype: d.subtype || '',
        quality_score: typeof d.quality_score === 'number' ? d.quality_score : computeQualityScore(d),
        status: d.status === 'Available' ? null : (d.status || '').toLowerCase().replace(/\s+/g, '_') || null,
        obra_nueva: (d.propertyTypeId || '').charAt(0) === '5',
        has_3d_tour: false,
        images: (d.images || []).slice(0, 1),
        description_es: d.description_es || d.description || '',
        description_en: d.description_en || '',
        features: (d.features || []).map(f => FEATURE_MAP[f] || f.toLowerCase().replace(/\s+/g, '_')),
        energy_rating: d.energyRated || null,
        agent: '',
        agency_ref: d.agencyRef || '',
        listed_date: null,
        resales_ref: d.reference
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

            const cacheKey = buildCacheKey({ city, propertyType, minPrice, maxPrice, minBedrooms,
                features: features.join(','), cursor, limit, sort, lang });
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

            const db = getDb();
            let query = db.collection('listings');

            if (city) query = query.where('location', '==', city);
            if (minPrice != null) query = query.where('price', '>=', minPrice);
            if (maxPrice != null) query = query.where('price', '<=', maxPrice);
            if (minBedrooms != null) query = query.where('bedrooms', '>=', minBedrooms);

            const hasPriceRange = minPrice != null || maxPrice != null;
            const hasBedroomsRange = minBedrooms != null;
            // Inequality fields must appear in the orderBy chain before any other ordering.
            // We compose the chain explicitly to avoid duplicates (Firestore rejects them).
            const orderings = [];
            if (hasPriceRange) orderings.push(['price', sort === 'price_desc' ? 'desc' : 'asc']);
            if (hasBedroomsRange) orderings.push(['bedrooms', 'asc']);
            if (sort === 'price_asc' && !hasPriceRange) orderings.push(['price', 'asc']);
            if (sort === 'price_desc' && !hasPriceRange) orderings.push(['price', 'desc']);
            if (sort === 'quality') {
                orderings.push(['quality_score', 'desc']);
                if (!hasPriceRange) orderings.push(['price', 'asc']); // tie-breaker; skip if price already in chain
            }
            for (const [field, dir] of orderings) query = query.orderBy(field, dir);

            if (cursor) {
                try {
                    const cursorSnap = await db.collection('listings').doc(cursor).get();
                    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
                } catch (e) {
                    context.log('Invalid cursor, ignoring:', cursor, e.message);
                }
            }

            query = query.limit(limit);

            const t0 = Date.now();
            const snapshot = await query.get();
            context.log('Firestore query returned', snapshot.size, 'docs in', Date.now() - t0, 'ms');

            const lastDocId = snapshot.size > 0 ? snapshot.docs[snapshot.size - 1].id : null;

            let mapped = [];
            snapshot.forEach(doc => mapped.push(mapToFrontend(doc.data())));

            // In-memory filters: features (array AND-match), propertyType (normalized).
            if (features.length > 0) {
                mapped = mapped.filter(p => {
                    const pf = p.features || [];
                    for (const f of features) if (pf.indexOf(f) === -1) return false;
                    return true;
                });
            }
            if (propertyType) {
                const want = propertyType.toLowerCase();
                mapped = mapped.filter(p => (p.type || '').toLowerCase() === want);
            }

            // nextCursor: last raw doc id if we hit the page limit. If Firestore returned fewer
            // than `limit`, there are no more rows for this query → null. (In-memory filters
            // may have removed some rows from `mapped`, but the cursor still tracks the
            // underlying scan position, which is the correct thing for pagination.)
            const nextCursor = snapshot.size === limit ? lastDocId : null;

            const body = { listings: mapped, nextCursor, count: mapped.length };
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
