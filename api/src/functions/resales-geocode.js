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

// Málaga province bounding box (approximate) — safety net regardless of geocoder
const BBOX = { north: 37.30, south: 36.30, west: -5.55, east: -4.20 };
// Bias point near centre of Málaga province for ambiguous duplicate place names
const PROXIMITY = '-4.6,36.5';
const MAPBOX_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places/';

function inBbox(lat, lng) {
    return lat >= BBOX.south && lat <= BBOX.north && lng >= BBOX.west && lng <= BBOX.east;
}

function confidenceFromRelevance(rel) {
    if (rel == null) return 'low';
    if (rel >= 0.8)  return 'high';
    if (rel >= 0.5)  return 'medium';
    return 'low';
}

function buildSearchText(loc) {
    const primary = loc.location || loc.area || '';
    const province = loc.province || '';
    if (!primary) return null;
    return [primary, province, 'Spain'].filter(Boolean).join(', ');
}

async function geocodeOnce(searchText, token) {
    const url = MAPBOX_BASE + encodeURIComponent(searchText) + '.json?' + new URLSearchParams({
        access_token: token,
        country: 'es',
        language: 'es',
        types: 'place,locality,neighborhood,address',
        proximity: PROXIMITY,
        limit: '1',
    }).toString();
    return fetch(url, { headers: { 'Accept': 'application/json' } });
}

async function geocode(loc, token, context) {
    const searchText = buildSearchText(loc);
    if (!searchText) return { status: 'none', reason: 'no-search-text' };

    let res;
    try {
        res = await geocodeOnce(searchText, token);
        if (res.status === 429) {
            await new Promise(r => setTimeout(r, 5000));
            res = await geocodeOnce(searchText, token);
        }
    } catch (e) {
        context.log('Mapbox network error for "' + searchText + '":', e.message);
        return { status: 'error', reason: 'network' };
    }

    if (res.status === 401 || res.status === 403) {
        return { status: 'error', reason: 'auth', http: res.status };
    }
    if (!res.ok) {
        return { status: 'error', reason: 'http-' + res.status };
    }

    let data;
    try { data = await res.json(); } catch (e) {
        return { status: 'error', reason: 'parse' };
    }
    if (!data.features || data.features.length === 0) {
        return { status: 'none', reason: 'no-features', searchText };
    }
    const f = data.features[0];
    const lng = f.center && f.center[0];
    const lat = f.center && f.center[1];
    if (lat == null || lng == null) return { status: 'none', reason: 'no-center' };
    if (!inBbox(lat, lng)) return { status: 'rejected', lat, lng, placeName: f.place_name };
    return {
        status: 'ok',
        lat, lng,
        confidence: confidenceFromRelevance(f.relevance),
        placeName: f.place_name,
        relevance: f.relevance,
    };
}

app.http('resales-geocode', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'resales/geocode',
    handler: async (request, context) => {
        const token = process.env.MAPBOX_TOKEN;
        if (!token) {
            return { status: 500, jsonBody: { error: 'MAPBOX_TOKEN not configured' } };
        }
        try {
            const db = getDb();
            const startTime = Date.now();
            const MAX_RUNTIME_MS = 8.5 * 60 * 1000;
            const mode = request.query.get('mode') || 'fill';
            // Modes:
            //   fill            — only docs with lat == null
            //   refine          — docs with confidence none/area/low/medium/rejected (Nominatim leftovers)
            //   mapbox_refresh  — re-geocode ALL docs regardless of confidence

            context.log('Geocode mode:', mode);
            let snapshot;
            if (mode === 'mapbox_refresh') {
                snapshot = await db.collection('listings')
                    .limit(10000)
                    .select('location', 'area', 'province', 'reference', 'locationConfidence', 'lat')
                    .get();
            } else if (mode === 'refine') {
                snapshot = await db.collection('listings')
                    .where('locationConfidence', 'in', ['none', 'area', 'low', 'medium', 'rejected'])
                    .limit(10000)
                    .select('location', 'area', 'province', 'reference')
                    .get();
            } else {
                snapshot = await db.collection('listings')
                    .where('lat', '==', null)
                    .limit(10000)
                    .select('location', 'area', 'province', 'reference')
                    .get();
            }

            if (snapshot.empty) {
                return { status: 200, jsonBody: { status: 'complete', mode, message: 'Nothing to process' } };
            }

            context.log('Found', snapshot.size, 'docs (mode=' + mode + ')');

            const locationMap = new Map();
            const docsByLocation = new Map();
            const skipKeys = new Set(); // mapbox_refresh: skip locations whose docs are all already 'high'
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
                docsByLocation.get(key).push({ id: doc.id, conf: d.locationConfidence });
            });

            // For mapbox_refresh: a location is "done" only if every doc under it is 'high' AND has lat
            if (mode === 'mapbox_refresh') {
                for (const [key, docs] of docsByLocation) {
                    if (docs.every(d => d.conf === 'high')) skipKeys.add(key);
                }
            }

            context.log('Unique locations:', locationMap.size, '(skipping', skipKeys.size, 'already-high)');

            let processed = 0, mapboxCalls = 0, mapboxErrors = 0;
            const counts = { high: 0, medium: 0, low: 0, rejected: 0, none: 0 };
            let listingsUpdated = 0;
            const BATCH_SIZE = 450;
            const failedExamples = [];

            for (const [key, loc] of locationMap) {
                if (Date.now() - startTime > MAX_RUNTIME_MS) {
                    context.log('Approaching timeout after', processed, 'locations');
                    break;
                }
                if (skipKeys.has(key)) { processed++; continue; }

                mapboxCalls++;
                const result = await geocode(loc, token, context);
                const docIds = docsByLocation.get(key).map(d => d.id);

                if (result.status === 'ok') {
                    counts[result.confidence]++;
                    for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        const chunk = docIds.slice(i, i + BATCH_SIZE);
                        for (const docId of chunk) {
                            batch.update(db.collection('listings').doc(docId), {
                                lat: result.lat, lng: result.lng,
                                locationConfidence: result.confidence,
                            });
                        }
                        await batch.commit();
                        listingsUpdated += chunk.length;
                    }
                    context.log('OK:', loc.location, '->', result.lat.toFixed(4), result.lng.toFixed(4),
                        result.confidence, '(rel=' + (result.relevance != null ? result.relevance.toFixed(2) : '?') + ',', docIds.length, 'listings)');
                } else if (result.status === 'rejected') {
                    counts.rejected++;
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
                    context.log('REJECTED (out of bbox):', loc.location, '->', result.lat, result.lng, '(' + result.placeName + ')');
                } else if (result.status === 'error') {
                    mapboxErrors++;
                    if (result.reason === 'auth') {
                        context.error('Mapbox auth failed — check token. http=', result.http);
                        return { status: 500, jsonBody: { error: 'Mapbox auth failed', http: result.http } };
                    }
                    context.log('ERROR:', loc.location, result.reason);
                } else {
                    counts.none++;
                    if (failedExamples.length < 5) failedExamples.push(result.searchText || loc.location);
                    context.log('NO MATCH:', result.searchText || loc.location, result.reason);
                }

                processed++;
                await new Promise(r => setTimeout(r, 200));
            }

            return {
                status: 200,
                jsonBody: {
                    status: processed < locationMap.size - skipKeys.size ? 'partial' : 'complete',
                    mode,
                    uniqueLocations: locationMap.size,
                    locationsSkipped: skipKeys.size,
                    locationsProcessed: processed - skipKeys.size,
                    listingsUpdated,
                    mapboxCalls,
                    mapboxErrors,
                    counts,
                    failedExamples,
                }
            };
        } catch (err) {
            context.error('Geocode error:', err.message, err.stack);
            return { status: 500, jsonBody: { error: err.message } };
        }
    }
});
