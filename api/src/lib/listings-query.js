// Shared listings query + frontend mapper.
//
// Used by:
//   resales-listings-paged.js — full feature surface (filters + cursor pagination).
//   resales-listings.js       — legacy thin shim, returns a flat array with a high
//                               limit so existing callers (favoritos, dashboard,
//                               agente-dashboard, mis-ofertas, visitas, index) keep
//                               working without changes.
//
// Composite indexes the filtered query paths rely on (auto-create on first miss):
//   listings (location, quality_score desc)
//   listings (price asc, quality_score desc)
//   listings (location, price asc)
//   listings (bedrooms asc, quality_score desc)
//   listings (location, bedrooms asc, quality_score desc)
//   listings (price asc, bedrooms asc, quality_score desc)

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
        features: d.features || [],
        energy_rating: d.energyRated || null,
        agent: '',
        agency_ref: d.agencyRef || '',
        listed_date: null,
        resales_ref: d.reference
    };
}

// Run a filtered + ordered + cursor-paginated listings query. Returns
// { listings, nextCursor, count }. Caller is responsible for caching.
async function queryListings(db, opts, context) {
    const {
        city = '',
        propertyType = '',
        minPrice = null,
        maxPrice = null,
        minBedrooms = null,
        features = [],
        confidence = '',
        cursor = '',
        limit = 50,
        sort = 'quality'
    } = opts || {};

    let query = db.collection('listings');

    if (city) query = query.where('location', '==', city);
    if (minPrice != null) query = query.where('price', '>=', minPrice);
    if (maxPrice != null) query = query.where('price', '<=', maxPrice);
    if (minBedrooms != null) query = query.where('bedrooms', '>=', minBedrooms);
    // confidence filter — used by the internal QA tooling to inspect properties
    // by Phase A triangulation tier. Single-field where, no extra index needed.
    if (confidence) query = query.where('locationConfidence', '==', confidence);

    const hasPriceRange = minPrice != null || maxPrice != null;
    const hasBedroomsRange = minBedrooms != null;
    // Inequality fields must appear in orderBy first; compose explicitly to avoid duplicates.
    const orderings = [];
    if (hasPriceRange) orderings.push(['price', sort === 'price_desc' ? 'desc' : 'asc']);
    if (hasBedroomsRange) orderings.push(['bedrooms', 'asc']);
    if (sort === 'price_asc' && !hasPriceRange) orderings.push(['price', 'asc']);
    if (sort === 'price_desc' && !hasPriceRange) orderings.push(['price', 'desc']);
    if (sort === 'quality') {
        orderings.push(['quality_score', 'desc']);
        if (!hasPriceRange) orderings.push(['price', 'asc']);
    }
    for (const [field, dir] of orderings) query = query.orderBy(field, dir);

    if (cursor) {
        try {
            const cursorSnap = await db.collection('listings').doc(cursor).get();
            if (cursorSnap.exists) query = query.startAfter(cursorSnap);
        } catch (e) {
            if (context && context.log) context.log('Invalid cursor, ignoring:', cursor, e.message);
        }
    }

    query = query.limit(limit);

    const t0 = Date.now();
    const snapshot = await query.get();
    if (context && context.log) {
        context.log('Firestore listings query →', snapshot.size, 'docs in', Date.now() - t0, 'ms');
    }

    const lastDocId = snapshot.size > 0 ? snapshot.docs[snapshot.size - 1].id : null;

    let mapped = [];
    snapshot.forEach(doc => mapped.push(mapToFrontend(doc.data())));

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

    // nextCursor tracks the underlying scan position, not the post-filter result.
    const nextCursor = snapshot.size === limit ? lastDocId : null;

    return { listings: mapped, nextCursor, count: mapped.length };
}

module.exports = { mapToFrontend, queryListings, computeQualityScore, normalizeType };
