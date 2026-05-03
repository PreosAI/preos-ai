// Spanish cadastre (Sede Electrónica del Catastro) client.
//
// Public, free, no-auth XML endpoints from ovc.catastro.meh.es. Used by the
// location triangulation pipeline (Phase A) to verify candidate coordinates
// against actual parcel records: address + m² built + year + use type.
//
// Two endpoints we hit:
//   1. Consulta_RCCOOR_Distancia — list nearby parcels for a (lat, lng).
//      Returns up to ~25 parcels within ~50 m of the input point with their
//      cadastral reference (refcat = pc1+pc2 = 14 chars), distance, and
//      formatted address.
//   2. Consulta_DNPRC — fetch building details for a refcat. Returns m²,
//      year built, use type, full address. The "ant" field is typically
//      antiguedad (year built).
//
// Throttle: cadastre tolerates ~1 req/sec sustained. We enforce a 1100 ms
// minimum between requests via a simple in-process queue. If two callers
// run concurrently in the same process, they share the throttle.
//
// Parsing: responses are SOAP-style XML. We use regex over the documented
// fields (pc1/pc2/dis/ldt/sfc/ant/luso). If the response shape ever changes
// the smoke test will catch it before the backfill goes near production.

const RCCOOR_DISTANCIA_URL =
    'https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR_Distancia';
const DNPRC_URL =
    'https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC';

const THROTTLE_MS = 1100;
let _lastRequestAt = 0;

async function throttle() {
    const now = Date.now();
    const wait = _lastRequestAt + THROTTLE_MS - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _lastRequestAt = Date.now();
}

async function fetchXml(url, params) {
    await throttle();
    const qs = new URLSearchParams(params).toString();
    const full = url + '?' + qs;
    const res = await fetch(full, {
        headers: {
            'Accept': 'application/xml,text/xml,*/*',
            'User-Agent': 'PreosAI/Phase-A cadastre-client'
        }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error('cadastre ' + res.status + ' ' + body.slice(0, 200));
    }
    return res.text();
}

// Extract first match group from an XML tag, scoped to a substring.
function tag(xml, name) {
    const m = xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'));
    return m ? m[1].trim() : '';
}

// Extract every <name>...</name> block; returns array of inner XML strings.
function tagAll(xml, name) {
    const re = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>', 'g');
    const out = [];
    let m;
    while ((m = re.exec(xml)) !== null) out.push(m[1]);
    return out;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Find cadastral parcels near a coordinate.
 * @param {number} lat WGS84 latitude (Y).
 * @param {number} lng WGS84 longitude (X).
 * @returns {Promise<Array<{refcat:string, distance:number, address:string}>>}
 *          Sorted by distance ascending. Empty array if none within radius.
 */
async function lookupByCoords(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('lookupByCoords: invalid coords ' + lat + ',' + lng);
    }
    const xml = await fetchXml(RCCOOR_DISTANCIA_URL, {
        SRS: 'EPSG:4326',
        Coordenada_X: String(lng),
        Coordenada_Y: String(lat)
    });

    // Surface the service-level error block first so callers don't silently
    // get an empty list when the request was actually rejected.
    const err = tag(xml, 'err');
    if (err) {
        const code = tag(err, 'cod');
        const desc = tag(err, 'des');
        if (code || desc) {
            throw new Error('cadastre RCCOOR_Distancia error ' + code + ': ' + desc);
        }
    }

    // Each <pcd> is one nearby parcel.
    const parcels = tagAll(xml, 'pcd').map(block => {
        const pc1 = tag(block, 'pc1');
        const pc2 = tag(block, 'pc2');
        const refcat = (pc1 + pc2).trim();
        const distance = parseFloat(tag(block, 'dis')) || 0;
        const address = tag(block, 'ldt');
        return { refcat, distance, address };
    }).filter(p => p.refcat.length >= 14);

    parcels.sort((a, b) => a.distance - b.distance);
    return parcels;
}

/**
 * Fetch building / parcel details for a cadastral reference.
 * @param {string} refcat 14-char (or 20-char) cadastral reference.
 * @returns {Promise<{
 *   refcat:string,
 *   address:string,
 *   m2:number|null,
 *   year:number|null,
 *   useType:string|null,
 *   municipality:string,
 *   province:string
 * }|null>} null if cadastre returned no parcel.
 */
async function lookupParcelDetails(refcat) {
    if (!refcat || refcat.length < 14) {
        throw new Error('lookupParcelDetails: refcat must be ≥14 chars');
    }
    const xml = await fetchXml(DNPRC_URL, {
        Provincia: '',
        Municipio: '',
        RC: refcat.slice(0, 14)
    });

    const err = tag(xml, 'err');
    if (err) {
        const code = tag(err, 'cod');
        const desc = tag(err, 'des');
        // Cadastre returns codeful errors for "no parcel found" — surface as null.
        if (code === '43' || /no.*existe|no.*encontrad/i.test(desc)) return null;
        throw new Error('cadastre DNPRC error ' + code + ': ' + desc);
    }

    // The response wraps building info in <bi>; m² is <sfc>, year is <ant>,
    // use type is <luso> inside <debi>. Address is <ldt>. Some responses
    // report multiple <bi> for split parcels — we use the first.
    const bi = tag(xml, 'bi') || xml;
    const debi = tag(bi, 'debi');
    const m2Raw = tag(debi, 'sfc');
    const yearRaw = tag(debi, 'ant');
    const useType = tag(debi, 'luso') || null;
    const address = tag(bi, 'ldt') || tag(xml, 'ldt');
    const municipality = tag(tag(bi, 'dt') || tag(xml, 'dt'), 'nm');
    const province = tag(tag(bi, 'dt') || tag(xml, 'dt'), 'np');

    return {
        refcat,
        address,
        m2: m2Raw ? parseInt(m2Raw, 10) || null : null,
        year: yearRaw ? parseInt(yearRaw, 10) || null : null,
        useType,
        municipality,
        province
    };
}

/**
 * Score how well a cadastre parcel matches a listing's metadata.
 *
 * Returns 0-100. The m² match dominates (60 pts) because it's the most
 * stable signal across cadastre vs agent listings; year is a softer signal
 * (25 pts, 5-year window); use-type compatibility is a hard gate (15 pts,
 * residential-vs-commercial mismatch zeroes the score).
 *
 * @param {object} parcel  result of lookupParcelDetails
 * @param {object} listing { m2_built, year_built, type }
 * @returns {{ score: number, breakdown: object }}
 */
function scoreParcelMatch(parcel, listing) {
    const breakdown = {};
    let score = 0;

    // Use-type compatibility: hard gate.
    const useTypeOk = isUseTypeCompatible(parcel.useType, listing.type);
    breakdown.useType = { parcel: parcel.useType, listing: listing.type, ok: useTypeOk };
    if (!useTypeOk) {
        return { score: 0, breakdown };
    }
    score += 15;

    // m² built within 15% — full 60 pts at exact, scaled down to 0 at 15%+.
    if (parcel.m2 != null && listing.m2_built != null && parcel.m2 > 0 && listing.m2_built > 0) {
        const pctDiff = Math.abs(parcel.m2 - listing.m2_built) / Math.max(parcel.m2, listing.m2_built);
        if (pctDiff <= 0.15) {
            const m2Pts = Math.round(60 * (1 - pctDiff / 0.15));
            score += m2Pts;
            breakdown.m2 = { parcel: parcel.m2, listing: listing.m2_built, pctDiff, pts: m2Pts };
        } else {
            breakdown.m2 = { parcel: parcel.m2, listing: listing.m2_built, pctDiff, pts: 0 };
        }
    } else {
        breakdown.m2 = { parcel: parcel.m2, listing: listing.m2_built, pts: 0, reason: 'missing' };
    }

    // Year built within 5 years — full 25 pts at exact, 0 at 5+ years off.
    if (parcel.year != null && listing.year_built != null && parcel.year > 0 && listing.year_built > 0) {
        const yearDiff = Math.abs(parcel.year - listing.year_built);
        if (yearDiff <= 5) {
            const yearPts = Math.round(25 * (1 - yearDiff / 5));
            score += yearPts;
            breakdown.year = { parcel: parcel.year, listing: listing.year_built, diff: yearDiff, pts: yearPts };
        } else {
            breakdown.year = { parcel: parcel.year, listing: listing.year_built, diff: yearDiff, pts: 0 };
        }
    } else {
        breakdown.year = { parcel: parcel.year, listing: listing.year_built, pts: 0, reason: 'missing' };
    }

    return { score: Math.min(100, score), breakdown };
}

// Cadastre use types (luso): RESIDENCIAL, COMERCIAL, OFICINAS, INDUSTRIAL,
// SUELO_SIN_EDIFICAR, etc. Listings type values: Apartamento, Villa, Adosado,
// Ático, Solar, Local. Map them to a coarse compatibility check.
function isUseTypeCompatible(parcelUse, listingType) {
    if (!parcelUse) return true; // no info → don't block
    const u = parcelUse.toUpperCase();
    const t = (listingType || '').toLowerCase();

    const isCommercial = u.includes('COMERCIAL') || u.includes('OFICINAS') || u.includes('INDUSTRIAL');
    const isResidential = u.includes('RESIDENCIAL') || u.includes('VIVIENDA');
    const isLand = u.includes('SUELO_SIN_EDIFICAR') || u.includes('SUELO');

    if (t === 'local') return isCommercial;
    if (t === 'solar') return isLand;
    // Apartamento, Villa, Adosado, Ático → residential. Reject commercial/land.
    if (['apartamento', 'villa', 'adosado', 'ático', 'atico', 'penthouse'].includes(t)) {
        return isResidential || (!isCommercial && !isLand);
    }
    return true; // unknown listing type → don't block
}

/**
 * High-level helper: take the parcels from lookupByCoords plus the listing
 * metadata, fetch each parcel's details and score it. Returns the best
 * match (highest score) with full reasoning trace, or null if nothing fit.
 *
 * Rate-limit footprint: 1 detail call per nearby parcel. Caller can cap how
 * many parcels to inspect via maxParcels (default 5 — usually only the
 * nearest 1-3 are worth checking).
 */
async function matchParcelToListing(parcels, listingMeta, opts) {
    const { maxParcels = 5 } = opts || {};
    if (!parcels || parcels.length === 0) {
        return { match: null, candidates: [], reason: 'no-parcels' };
    }

    const candidates = [];
    for (const p of parcels.slice(0, maxParcels)) {
        let details = null;
        try {
            details = await lookupParcelDetails(p.refcat);
        } catch (e) {
            candidates.push({ refcat: p.refcat, distance: p.distance, error: e.message });
            continue;
        }
        if (!details) {
            candidates.push({ refcat: p.refcat, distance: p.distance, error: 'no-details' });
            continue;
        }
        const { score, breakdown } = scoreParcelMatch(details, listingMeta);
        candidates.push({
            refcat: p.refcat,
            distance: p.distance,
            address: details.address || p.address,
            m2: details.m2,
            year: details.year,
            useType: details.useType,
            score,
            breakdown
        });
    }

    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    const best = candidates[0];
    if (!best || (best.score || 0) === 0) {
        return { match: null, candidates, reason: 'no-confident-match' };
    }
    return { match: best, candidates };
}

module.exports = {
    lookupByCoords,
    lookupParcelDetails,
    matchParcelToListing,
    scoreParcelMatch,
    isUseTypeCompatible
};
