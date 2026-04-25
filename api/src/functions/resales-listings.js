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

// In-memory cache
let listingsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

function mapToFrontend(doc) {
    const d = doc;
    const type = d.propertyType || 'Propiedad';
    const sub = d.subtype || '';
    const t = (type + ' ' + sub).toLowerCase();

    let normalizedType = type;
    if (t.indexOf('apartment') > -1 || t.indexOf('flat') > -1 || t.indexOf('studio') > -1) normalizedType = 'Apartamento';
    else if (t.indexOf('villa') > -1 || t.indexOf('chalet') > -1 || t.indexOf('house') > -1) normalizedType = 'Villa';
    else if (t.indexOf('townhouse') > -1 || t.indexOf('semi') > -1) normalizedType = 'Adosado';
    else if (t.indexOf('penthouse') > -1) normalizedType = 'Ático';
    else if (t.indexOf('plot') > -1 || t.indexOf('land') > -1) normalizedType = 'Solar';
    else if (t.indexOf('commercial') > -1) normalizedType = 'Local';

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
        type: normalizedType,
        subtype: d.subtype || '',
        status: d.status === 'Available' ? null : (d.status || '').toLowerCase().replace(/\s+/g, '_') || null,
        obra_nueva: (d.propertyTypeId || '').charAt(0) === '5',
        has_3d_tour: false,
        images: d.images || [],
        description: d.description || '',
        description_en: '',
        features: (d.features || []).map(f => {
            const map = {
                'Pool': 'pool', 'Garden': 'garden', 'Parking': 'garage',
                'Garage': 'garage', 'Air Conditioning': 'air_conditioning',
                'Elevator': 'elevator', 'Lift': 'elevator',
                'Sea Views': 'sea_views', 'Beachfront': 'beachfront',
                'Terrace': 'terrace'
            };
            return map[f] || f.toLowerCase().replace(/\s+/g, '_');
        }),
        energy_rating: d.energyRated || null,
        agent: '',
        agency_ref: d.agencyRef || '',
        listed_date: null,
        resales_ref: d.reference
    };
}

app.http('resales-listings', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'resales/listings',
    handler: async (request, context) => {
        const cors = getCorsHeaders(request);

        if (request.method === 'OPTIONS') {
            return { status: 204, headers: cors };
        }

        try {
            const now = Date.now();

            if (!listingsCache || (now - cacheTimestamp > CACHE_TTL_MS)) {
                context.log('Loading listings from Firestore...');
                const db = getDb();
                const snapshot = await db.collection('listings').get();
                listingsCache = [];
                snapshot.forEach(doc => {
                    listingsCache.push(mapToFrontend(doc.data()));
                });
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
            return {
                status: 500,
                headers: cors,
                jsonBody: { error: err.message }
            };
        }
    }
});
