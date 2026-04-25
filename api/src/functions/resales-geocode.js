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

async function geocode(query) {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q: query, format: 'json', limit: '1', countrycodes: 'es'
    });
    const res = await fetch(url, {
        headers: { 'User-Agent': 'PreosAI/1.0 (preos.ai)' }
    });
    const data = await res.json();
    if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
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

            // Step 1: Get all unique location combinations from listings where lat is null
            context.log('Reading listings without coordinates...');
            const snapshot = await db.collection('listings')
                .where('lat', '==', null)
                .limit(5000)
                .select('location', 'area', 'province', 'reference')
                .get();

            if (snapshot.empty) {
                return { status: 200, jsonBody: { status: 'complete', message: 'All listings already geocoded' } };
            }

            context.log('Found', snapshot.size, 'listings without coordinates');

            // Step 2: Extract unique location keys
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

            context.log('Unique locations to geocode:', locationMap.size);

            // Step 3: Geocode each unique location
            let geocoded = 0;
            let updated = 0;
            const BATCH_SIZE = 450;

            for (const [key, loc] of locationMap) {
                if (Date.now() - startTime > MAX_RUNTIME_MS) {
                    context.log('Approaching timeout after', geocoded, 'locations');
                    break;
                }

                const query = [loc.location, loc.area, loc.province, 'Spain']
                    .filter(Boolean).join(', ');
                const geo = await geocode(query);

                if (geo) {
                    // Update all listings with this location
                    const docIds = docsByLocation.get(key);
                    for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        const chunk = docIds.slice(i, i + BATCH_SIZE);
                        for (const docId of chunk) {
                            batch.update(db.collection('listings').doc(docId), {
                                lat: geo.lat,
                                lng: geo.lng,
                                locationConfidence: 'area'
                            });
                        }
                        await batch.commit();
                        updated += chunk.length;
                    }
                    context.log('Geocoded:', loc.location, '->', geo.lat, geo.lng,
                        '(', docsByLocation.get(key).length, 'listings)');
                } else {
                    context.log('Failed to geocode:', query);
                }

                geocoded++;
                // Nominatim rate limit: 1 req/sec
                await new Promise(r => setTimeout(r, 1100));
            }

            return {
                status: 200,
                jsonBody: {
                    status: geocoded < locationMap.size ? 'partial' : 'complete',
                    uniqueLocations: locationMap.size,
                    geocoded,
                    listingsUpdated: updated,
                    remainingWithoutCoords: snapshot.size - updated
                }
            };
        } catch (err) {
            context.error('Geocode error:', err.message, err.stack);
            return { status: 500, jsonBody: { error: err.message } };
        }
    }
});
