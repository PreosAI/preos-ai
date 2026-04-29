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

// TEMPORARY diagnostic endpoint — to be deleted after Phase 1.5 investigation
app.http('resales-debug', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'resales/debug-doc',
    handler: async (request, context) => {
        try {
            const db = getDb();
            const ref = request.query.get('ref');

            if (ref) {
                const docSnap = await db.collection('listings').doc(ref).get();
                if (!docSnap.exists) {
                    return { status: 404, jsonBody: { error: 'not found', ref } };
                }
                const data = docSnap.data();
                return {
                    status: 200,
                    jsonBody: {
                        id: docSnap.id,
                        fieldNames: Object.keys(data).sort(),
                        lat: data.lat,
                        lng: data.lng,
                        locationConfidence: data.locationConfidence,
                        location: data.location,
                        area: data.area,
                        province: data.province,
                        syncedAt: data.syncedAt ? data.syncedAt.toDate().toISOString() : null
                    }
                };
            }

            // Aggregate: total docs vs docs with non-null lat
            const totalSnap = await db.collection('listings').count().get();
            const totalDocs = totalSnap.data().count;

            const geocodedSnap = await db.collection('listings').where('lat', '>', 0).count().get();
            const geocodedDocs = geocodedSnap.data().count;

            const sampleSnap = await db.collection('listings').limit(5).get();
            const samples = [];
            sampleSnap.forEach(doc => {
                const d = doc.data();
                samples.push({
                    id: doc.id,
                    lat: d.lat,
                    lng: d.lng,
                    locationConfidence: d.locationConfidence,
                    location: d.location,
                    province: d.province
                });
            });

            const lastSyncSnap = await db.collection('sync_meta').doc('last_sync').get();
            const lastSync = lastSyncSnap.exists ? lastSyncSnap.data() : null;
            const serializedLastSync = lastSync ? Object.fromEntries(
                Object.entries(lastSync).map(([k, v]) => [k, v && v.toDate ? v.toDate().toISOString() : v])
            ) : null;

            return {
                status: 200,
                jsonBody: {
                    totalDocs,
                    geocodedDocs,
                    missingCoords: totalDocs - geocodedDocs,
                    geocodedPct: ((geocodedDocs / totalDocs) * 100).toFixed(2) + '%',
                    samples,
                    lastSync: serializedLastSync
                }
            };
        } catch (err) {
            return { status: 500, jsonBody: { error: err.message, stack: err.stack } };
        }
    }
});
