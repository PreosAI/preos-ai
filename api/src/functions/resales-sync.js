const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');
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

const RESALES_BASE = 'https://webapi.resales-online.com/V6';

async function resalesFetch(endpoint, params) {
    const url = new URL(RESALES_BASE + '/' + endpoint);
    url.searchParams.set('p1', process.env.RESALES_P1);
    url.searchParams.set('p2', process.env.RESALES_P2);
    for (const [k, v] of Object.entries(params || {})) {
        url.searchParams.set(k, v);
    }
    const fetchOptions = { headers: { 'Accept': 'application/json' } };
    if (process.env.FIXIE_URL) {
        fetchOptions.dispatcher = new ProxyAgent(process.env.FIXIE_URL);
    }
    const res = await undiciFetch(url.toString(), fetchOptions);
    return res.json();
}

function mapProperty(raw) {
    const images = [];
    if (raw.Pictures && raw.Pictures.Picture) {
        const pics = Array.isArray(raw.Pictures.Picture)
            ? raw.Pictures.Picture : [raw.Pictures.Picture];
        pics.forEach(p => { if (p.PictureURL) images.push(p.PictureURL); });
    }

    const features = [];
    if (raw.PropertyFeatures && raw.PropertyFeatures.Category) {
        const cats = Array.isArray(raw.PropertyFeatures.Category)
            ? raw.PropertyFeatures.Category : [raw.PropertyFeatures.Category];
        cats.forEach(c => {
            if (c.Type) features.push(c.Type);
            if (c.Value) {
                const vals = Array.isArray(c.Value) ? c.Value : [c.Value];
                vals.forEach(v => features.push(v));
            }
        });
    }

    return {
        reference: raw.Reference || '',
        agencyRef: raw.AgencyRef || '',
        country: raw.Country || '',
        province: raw.Province || '',
        area: raw.Area || '',
        location: raw.Location || '',
        subLocation: raw.SubLocation || '',
        propertyType: raw.PropertyType ? raw.PropertyType.NameType || '' : '',
        propertyTypeCategory: raw.PropertyType ? raw.PropertyType.Type || '' : '',
        propertyTypeId: raw.PropertyType ? raw.PropertyType.TypeId || '' : '',
        subtype: raw.PropertyType ? raw.PropertyType.Subtype1 || '' : '',
        status: raw.Status ? (raw.Status.system || '') : '',
        bedrooms: parseInt(raw.Bedrooms) || 0,
        bathrooms: parseInt(raw.Bathrooms) || 0,
        price: parseFloat(raw.Price) || 0,
        originalPrice: raw.OriginalPrice || 0,
        currency: raw.Currency || 'EUR',
        built: raw.Built || 0,
        terrace: raw.Terrace || 0,
        gardenPlot: raw.GardenPlot || 0,
        pool: raw.Pool === 1 || raw.Pool === '1',
        parking: raw.Parking === 1 || raw.Parking === '1',
        garden: raw.Garden === 1 || raw.Garden === '1',
        energyRated: raw.EnergyRated || '',
        co2Rated: raw.CO2Rated || '',
        description: raw.Description || '',
        features: features,
        images: images,
        imageCount: images.length,
        lat: null,
        lng: null,
        locationConfidence: 'none',
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

async function writeBatch(db, properties) {
    const BATCH_SIZE = 450;
    for (let i = 0; i < properties.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = properties.slice(i, i + BATCH_SIZE);
        for (const doc of chunk) {
            const ref = db.collection('listings').doc(doc.reference);
            batch.set(ref, doc, { merge: true });
        }
        await batch.commit();
    }
}

app.http('resales-sync', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'resales/sync',
    handler: async (request, context) => {
        const p1 = process.env.RESALES_P1;
        const p2 = process.env.RESALES_P2;
        if (!p1 || !p2) {
            return { status: 503, jsonBody: { error: 'API credentials not configured' } };
        }

        const startPage = parseInt(request.query.get('startPage') || '1');
        const filterAlias = request.query.get('filter') || process.env.RESALES_FILTER_ID || '1';
        const pageSize = 100;
        const startTime = Date.now();
        const MAX_RUNTIME_MS = 8.5 * 60 * 1000; // Stop at 8.5 min to leave buffer
        let page = startPage;
        let totalSynced = 0;
        let totalProperties = 0;
        let stoppedEarly = false;

        try {
            const db = getDb();

            while (true) {
                // Check if we're running out of time
                if (Date.now() - startTime > MAX_RUNTIME_MS) {
                    context.log('Approaching timeout, stopping at page', page);
                    stoppedEarly = true;
                    break;
                }

                context.log('Fetching page', page);
                const data = await resalesFetch('SearchProperties', {
                    p_agency_filterid: filterAlias,
                    p_pagesize: String(pageSize),
                    p_pagenumber: String(page),
                });

                if (data.transaction && data.transaction.status === 'error') {
                    context.error('API error:', JSON.stringify(data.transaction));
                    break;
                }

                if (!data.Property || data.Property.length === 0) {
                    context.log('No more properties at page', page);
                    break;
                }

                if (page === startPage && data.QueryInfo) {
                    totalProperties = data.QueryInfo.PropertyCount || 0;
                    context.log('Total properties:', totalProperties);
                }

                // Map and write this page immediately
                const docs = data.Property.map(p => mapProperty(p));
                await writeBatch(db, docs);
                totalSynced += docs.length;
                context.log('Page', page, 'written.', totalSynced, 'total synced');

                page++;
                await new Promise(r => setTimeout(r, 300));
            }

            // Save progress
            await db.collection('sync_meta').doc('last_sync').set({
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastPage: page - 1,
                totalSynced: totalSynced,
                totalProperties: totalProperties,
                stoppedEarly: stoppedEarly,
                nextPage: stoppedEarly ? page : null,
                filterAlias: filterAlias
            }, { merge: true });

            return {
                status: 200,
                jsonBody: {
                    status: stoppedEarly ? 'partial' : 'complete',
                    totalSynced,
                    totalProperties,
                    lastPage: page - 1,
                    nextPage: stoppedEarly ? page : null,
                    message: stoppedEarly
                        ? 'Stopped early due to timeout. Run again with ?startPage=' + page
                        : 'Sync complete'
                }
            };
        } catch (err) {
            context.error('Sync error:', err.message, err.stack);
            return {
                status: 500,
                jsonBody: { error: 'Sync failed', detail: err.message, lastPage: page, totalSynced }
            };
        }
    }
});
