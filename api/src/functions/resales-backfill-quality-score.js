// TEMPORARY one-shot backfill endpoint — DELETE in a follow-up commit after running.
// Recomputes quality_score on every doc in the listings collection using the full formula.
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

function computeQualityScore(d) {
    const conf = d.locationConfidence;
    const confPts = conf === 'high' ? 40 : conf === 'medium' ? 20 : 0;
    const imgPts = Math.min(d.imageCount || (d.images ? d.images.length : 0), 10) * 3;
    const bedPts = (d.bedrooms || 0) > 0 ? 15 : 0;
    const price = d.price || 0;
    const pricePts = (price >= 50000 && price <= 5000000) ? 15 : 0;
    return confPts + imgPts + bedPts + pricePts;
}

app.http('resales-backfill-quality-score', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'resales/backfill-quality-score',
    handler: async (request, context) => {
        try {
            const db = getDb();
            const startTime = Date.now();
            const MAX_RUNTIME_MS = 8.5 * 60 * 1000;

            const snapshot = await db.collection('listings')
                .select('locationConfidence', 'imageCount', 'images', 'bedrooms', 'price')
                .get();

            const buckets = { '0-25': 0, '25-50': 0, '50-75': 0, '75-100': 0 };
            const BATCH_SIZE = 450;
            let updated = 0;
            const total = snapshot.size;
            const docs = [];
            snapshot.forEach(doc => docs.push({ id: doc.id, data: doc.data() }));

            for (let i = 0; i < docs.length; i += BATCH_SIZE) {
                if (Date.now() - startTime > MAX_RUNTIME_MS) {
                    context.log('Approaching timeout, stopping at', updated, 'of', total);
                    break;
                }
                const batch = db.batch();
                const chunk = docs.slice(i, i + BATCH_SIZE);
                for (const { id, data } of chunk) {
                    const score = computeQualityScore(data);
                    if (score < 25) buckets['0-25']++;
                    else if (score < 50) buckets['25-50']++;
                    else if (score < 75) buckets['50-75']++;
                    else buckets['75-100']++;
                    batch.set(db.collection('listings').doc(id), { quality_score: score }, { merge: true });
                }
                await batch.commit();
                updated += chunk.length;
            }

            return {
                status: 200,
                jsonBody: { status: updated === total ? 'complete' : 'partial', total, updated, histogram: buckets }
            };
        } catch (err) {
            context.error('Backfill error:', err.message, err.stack);
            return { status: 500, jsonBody: { error: err.message } };
        }
    }
});
