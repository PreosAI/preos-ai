const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');
const admin = require('firebase-admin');
const { parseFeaturesTree } = require('../lib/features');

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

// Partial quality_score (no locationConfidence yet — geocoder recomputes the full score later).
// Full formula lives in resales-listings.js / resales-property.js / resales-geocode.js.
function partialQualityScore(imageCount, bedrooms, price) {
    const imgPts = Math.min(imageCount || 0, 10) * 3;
    const bedPts = (bedrooms || 0) > 0 ? 15 : 0;
    const pricePts = (price >= 50000 && price <= 5000000) ? 15 : 0;
    return imgPts + bedPts + pricePts;
}

function mapProperty(raw, lang) {
    const descField = lang === 'en' ? 'description_en' : 'description_es';
    const images = [];
    if (raw.Pictures && raw.Pictures.Picture) {
        const pics = Array.isArray(raw.Pictures.Picture)
            ? raw.Pictures.Picture : [raw.Pictures.Picture];
        pics.forEach(p => { if (p.PictureURL) images.push(p.PictureURL); });
    }

    const bedrooms = parseInt(raw.Bedrooms) || 0;
    const price = parseFloat(raw.Price) || 0;

    const out = {
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
        bedrooms: bedrooms,
        bathrooms: parseInt(raw.Bathrooms) || 0,
        price: price,
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
        [descField]: raw.Description || '',
        images: images,
        imageCount: images.length,
        quality_score: partialQualityScore(images.length, bedrooms, price),
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Resales translates Category Type/Value names per p_lang, so parsing on a
    // Spanish run produces "posicion_*" / "aparcamiento_*" prefixes that don't
    // match the English filter terms the frontend uses. Lock features to the
    // English sync only — lang=es runs leave the existing features field intact.
    if (lang === 'en') out.features = parseFeaturesTree(raw.PropertyFeatures);
    return out;
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
        const langParam = (request.query.get('lang') || 'es').toLowerCase();
        const lang = langParam === 'en' ? 'en' : 'es';
        const pLang = lang === 'en' ? '1' : '2';
        const pageSize = 40;
        const startTime = Date.now();
        const MAX_RUNTIME_MS = 150 * 1000; // 2.5 min — stay under 230s Azure gateway timeout
        let page = startPage;
        let totalSynced = 0;
        let totalProperties = 0;
        let emptyDescCount = 0;
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
                    p_PageSize: String(pageSize),
                    p_PageNo: String(page),
                    p_lang: pLang,
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
                const docs = data.Property.map(p => mapProperty(p, lang));
                for (const p of data.Property) {
                    if (!p.Description) emptyDescCount++;
                }
                await writeBatch(db, docs);
                totalSynced += docs.length;
                context.log('Page', page, 'written.', totalSynced, 'total synced');

                page++;
                await new Promise(r => setTimeout(r, 300));
            }

            context.log('Sync (' + lang + ') finished. emptyDescCount=' + emptyDescCount);

            // Save progress per language
            await db.collection('sync_meta').doc('last_sync_' + lang).set({
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastPage: page - 1,
                totalSynced: totalSynced,
                totalProperties: totalProperties,
                stoppedEarly: stoppedEarly,
                nextPage: stoppedEarly ? page : null,
                filterAlias: filterAlias,
                lang: lang,
                emptyDescCount: emptyDescCount
            }, { merge: true });

            return {
                status: 200,
                jsonBody: {
                    status: stoppedEarly ? 'partial' : 'complete',
                    lang,
                    totalSynced,
                    totalProperties,
                    emptyDescCount,
                    lastPage: page - 1,
                    nextPage: stoppedEarly ? page : null,
                    message: stoppedEarly
                        ? 'Stopped early due to timeout. Run again with ?lang=' + lang + '&startPage=' + page
                        : 'Sync complete'
                }
            };
        } catch (err) {
            context.error('Sync error:', err.message, err.stack);
            return {
                status: 500,
                jsonBody: { error: 'Sync failed', detail: err.message, lang, lastPage: page, totalSynced }
            };
        }
    }
});
