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

// Málaga province bounding box (approximate)
const BBOX = { north: 37.30, south: 36.30, west: -5.55, east: -4.20 };

// Marketing/non-administrative regions Nominatim cannot resolve as a county
const MARKETING_REGIONS = new Set([
    'costa del sol', 'costa tropical', 'costa de la luz',
    'axarquia', 'axarquía', 'serrania de ronda', 'serranía de ronda',
]);

function inBbox(lat, lng) {
    return lat >= BBOX.south && lat <= BBOX.north && lng >= BBOX.west && lng <= BBOX.east;
}

function confidenceFromImportance(importance) {
    if (importance == null) return 'low';
    if (importance > 0.5) return 'high';
    if (importance >= 0.3) return 'medium';
    return 'low';
}

async function geocode(loc) {
    const params = new URLSearchParams({
        format: 'json', limit: '1', countrycodes: 'es', addressdetails: '0',
    });
    if (loc.location)  params.set('city', loc.location);
    const areaLower = (loc.area || '').toLowerCase();
    if (loc.area && !MARKETING_REGIONS.has(areaLower)) params.set('county', loc.area);
    if (loc.province)  params.set('state', loc.province);
    params.set('country', 'Spain');

    const url = 'https://nominatim.openstreetmap.org/search?' + params.toString();
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'PreosAI/1.0 (preos.ai)' }
        });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('json')) return null;
        const data = await res.json();
        if (!data || data.length === 0) return null;
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (!inBbox(lat, lng)) return { rejected: true, lat, lng };
        return {
            lat, lng,
            confidence: confidenceFromImportance(data[0].importance),
        };
    } catch (e) { /* rate-limit / parse / network — treat as failed geocode */ }
    return null;
}

app.http('resales-geocode', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'resales/geocode',
    handler: async (request, context) => {
        try {
            const db = getDb();
            const startTime = Date.now();
            const MAX_RUNTIME_MS = 8.5 * 60 * 1000;
            const mode = request.query.get('mode') || 'fill'; // 'fill' (lat null) or 'refine' (low/medium confidence + null)

            context.log('Geocode mode:', mode);
            const baseQuery = db.collection('listings');
            let snapshot;
            if (mode === 'refine') {
                // Refine: anything not 'high' confidence, capped
                snapshot = await baseQuery
                    .where('locationConfidence', 'in', ['none', 'area', 'low', 'medium'])
                    .limit(5000)
                    .select('location', 'area', 'province', 'reference')
                    .get();
            } else {
                snapshot = await baseQuery
                    .where('lat', '==', null)
                    .limit(5000)
                    .select('location', 'area', 'province', 'reference')
                    .get();
            }

            if (snapshot.empty) {
                return { status: 200, jsonBody: { status: 'complete', mode, message: 'Nothing to process' } };
            }

            context.log('Found', snapshot.size, 'docs to process (mode=' + mode + ')');

            const locationMap = new Map();
            const docsByLocation = new Map();
            snapshot.forEach(doc => {
                const d = doc.data();
                const key = [d.location, d.area, d.province].join('|');
                if (!locationMap.has(key)) {
                    locationMap.set(key, {
                        location: d.location || '',
                        area: d.area || '',
                        province: d.province || ''
                    });
                    docsByLocation.set(key, []);
                }
                docsByLocation.get(key).push(doc.id);
            });

            context.log('Unique locations:', locationMap.size);

            let geocoded = 0, updated = 0, rejected = 0, failed = 0;
            const BATCH_SIZE = 450;

            for (const [key, loc] of locationMap) {
                if (Date.now() - startTime > MAX_RUNTIME_MS) {
                    context.log('Approaching timeout after', geocoded, 'locations');
                    break;
                }

                const geo = await geocode(loc);
                if (geo && !geo.rejected) {
                    const docIds = docsByLocation.get(key);
                    for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        const chunk = docIds.slice(i, i + BATCH_SIZE);
                        for (const docId of chunk) {
                            batch.update(db.collection('listings').doc(docId), {
                                lat: geo.lat,
                                lng: geo.lng,
                                locationConfidence: geo.confidence,
                            });
                        }
                        await batch.commit();
                        updated += chunk.length;
                    }
                    context.log('OK:', loc.location, '->', geo.lat, geo.lng, geo.confidence,
                        '(', docsByLocation.get(key).length, 'listings)');
                } else if (geo && geo.rejected) {
                    rejected++;
                    // Mark as 'rejected' so refine mode skips next time
                    const docIds = docsByLocation.get(key);
                    for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        const chunk = docIds.slice(i, i + BATCH_SIZE);
                        for (const docId of chunk) {
                            batch.update(db.collection('listings').doc(docId), {
                                lat: null, lng: null,
                                locationConfidence: 'rejected',
                            });
                        }
                        await batch.commit();
                    }
                    context.log('REJECTED (out of bbox):',
                        loc.location, '->', geo.lat, geo.lng, '(', docsByLocation.get(key).length, 'listings)');
                } else {
                    failed++;
                    context.log('FAILED:', loc.location);
                }

                geocoded++;
                await new Promise(r => setTimeout(r, 1100)); // Nominatim 1 req/sec
            }

            return {
                status: 200,
                jsonBody: {
                    status: geocoded < locationMap.size ? 'partial' : 'complete',
                    mode,
                    uniqueLocations: locationMap.size,
                    locationsProcessed: geocoded,
                    listingsUpdated: updated,
                    locationsRejected: rejected,
                    locationsFailed: failed,
                }
            };
        } catch (err) {
            context.error('Geocode error:', err.message, err.stack);
            return { status: 500, jsonBody: { error: err.message } };
        }
    }
});
