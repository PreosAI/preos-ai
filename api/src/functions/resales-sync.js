const { app } = require('@azure/functions');
const { fetch: undiciFetch, ProxyAgent } = require('undici');
const admin = require('firebase-admin');
const { parseFeaturesTree } = require('../lib/features');
const {
    fetchPropertyDetails,
    parseBuiltYear,
    parseFeeNumber,
    extractHighResImages,
    extractImagesCount,
    extractDescription,
    extractEnergyRating
} = require('../lib/property-details');

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
        // PropertyDetails enrichment is rate-limited at ~1 req/sec, so each
        // page now costs ~44 s of upstream time. Bump runtime budget to 200 s
        // (under the 230 s Azure gateway timeout) and check budget per page.
        const MAX_RUNTIME_MS = 200 * 1000;
        let page = startPage;
        let totalSynced = 0;
        let totalProperties = 0;
        let emptyDescCount = 0;
        let enrichedCount = 0;
        let enrichmentSkippedCount = 0;
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

                // Per-property enrichment via PropertyDetails. Done serially
                // so the 1100 ms throttle in the client is the actual cadence.
                // PropertyDetails returns BOTH descriptions plus BuiltYear,
                // /w1200/ image URLs, fees, EnergyRating — fields not in
                // SearchProperties.
                const docs = [];
                for (const raw of data.Property) {
                    if (!raw.Description) emptyDescCount++;
                    const baseDoc = mapProperty(raw, lang);
                    let pd = null;
                    try {
                        pd = await fetchPropertyDetails(raw.Reference, { lang: '1,2' });
                    } catch (err) {
                        const codes = (err && err.errorCodes) || {};
                        // Halt the whole sync on auth issues — rules say
                        // 401-equivalents must surface, not silently skip.
                        if (codes['001'] || codes['099'] || /\b40[13]\b/.test(String(err.message))) {
                            context.error('PropertyDetails auth failure on ' + raw.Reference + ':', err.message);
                            throw err;
                        }
                        // Other transient errors — log and continue, keep
                        // SearchProperties data only.
                        context.warn('PropertyDetails enrichment failed for ' + raw.Reference + ':', err.message);
                        enrichmentSkippedCount++;
                    }
                    if (pd) {
                        const built = parseBuiltYear(pd.BuiltYear);
                        if (built != null) {
                            baseDoc.year_built = built;
                            baseDoc.year_built_source = 'resales';
                        }
                        const highRes = extractHighResImages(pd);
                        if (highRes.length) {
                            baseDoc.images_high_res = highRes;
                            baseDoc.images_count = extractImagesCount(pd);
                        }
                        const ibi = parseFeeNumber(pd.IBI_Fees_Year);
                        if (ibi != null) baseDoc.ibi_fees_year = ibi;
                        const community = parseFeeNumber(pd.Community_Fees_Year);
                        if (community != null) baseDoc.community_fees_year = community;
                        const basura = parseFeeNumber(pd.Basura_Tax_Year);
                        if (basura != null) baseDoc.basura_tax_year = basura;
                        const energy = extractEnergyRating(pd);
                        if (energy) baseDoc.energy_rating = energy;
                        // PropertyDetails returns both languages in one call,
                        // so we always write both regardless of `lang` param.
                        const dEn = extractDescription(pd, 'en');
                        const dEs = extractDescription(pd, 'es');
                        if (dEn) baseDoc.description_en = dEn;
                        if (dEs) baseDoc.description_es = dEs;
                        enrichedCount++;
                    } else if (pd === null) {
                        // upstream success but no Property — deleted ref.
                        enrichmentSkippedCount++;
                    }
                    docs.push(baseDoc);
                }
                await writeBatch(db, docs);
                totalSynced += docs.length;
                context.log('Page', page, 'written.', totalSynced, 'total synced.',
                    'enriched=' + enrichedCount, 'skipped=' + enrichmentSkippedCount);

                page++;
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
                emptyDescCount: emptyDescCount,
                enrichedCount: enrichedCount,
                enrichmentSkippedCount: enrichmentSkippedCount
            }, { merge: true });

            return {
                status: 200,
                jsonBody: {
                    status: stoppedEarly ? 'partial' : 'complete',
                    lang,
                    totalSynced,
                    totalProperties,
                    emptyDescCount,
                    enrichedCount,
                    enrichmentSkippedCount,
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
                jsonBody: { error: 'Sync failed', detail: err.message, lang, lastPage: page, totalSynced,
                    enrichedCount, enrichmentSkippedCount }
            };
        }
    }
});
