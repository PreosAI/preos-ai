// Resales V6 PropertyDetails client.
//
// Used by resales-sync.js to enrich each listing with the fields that
// SearchProperties doesn't expose: BuiltYear, /w1200/ image URLs,
// bilingual Description / PropertyType / PropertyFeatures, IBI/community
// fees, EnergyRating object. See the investigation report for the full
// field comparison.
//
// Throttle: 1100 ms between requests to stay safely under Resales' 1 req/sec
// rate limit. Same cadence as the cadastre client. The throttle is
// process-global — multiple concurrent fetchPropertyDetails() calls share
// the queue, which is fine because the Function App backfill processes
// properties serially within each invocation.
//
// Auth: relies on RESALES_P1 / RESALES_P2 / RESALES_FILTER_ID env vars
// (same as SearchProperties). Routes through FIXIE_URL when set so the
// outbound IP matches the one whitelisted with Resales support — without
// it the upstream returns a 401 with errordescription.001 "the IP does
// not match with your API key".
//
// Filter id: PropertyDetails REQUIRES p_agency_filterid. The first probe
// without it returned errordescription.003 "FilterId and FilterAgencyId
// missing" and 099 "You are not authorised". Always sent.

const { fetch: undiciFetch, ProxyAgent } = require('undici');

const RESALES_BASE = 'https://webapi.resales-online.com/V6';
const THROTTLE_MS = 1100;
let _lastRequestAt = 0;

async function throttle() {
    const now = Date.now();
    const wait = _lastRequestAt + THROTTLE_MS - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _lastRequestAt = Date.now();
}

/**
 * Fetch the Resales PropertyDetails record for a single reference.
 *
 * @param {string} reference  the Resales `Reference` (e.g. "R166233")
 * @param {object} [options]
 * @param {string} [options.lang='1,2']        '1' EN, '2' ES, or '1,2' both (preferred)
 * @param {boolean} [options.useFixie=true]    route through FIXIE_URL when set
 * @param {string} [options.filterId]          override RESALES_FILTER_ID
 *
 * @returns {Promise<object|null>} the parsed `Property` object, or `null` if
 *   the upstream returned success but no Property (deleted / non-existent
 *   reference). Throws on auth / network / unknown errors so the caller can
 *   halt and surface them.
 */
async function fetchPropertyDetails(reference, options) {
    if (!reference) throw new Error('fetchPropertyDetails: reference required');
    const opts = options || {};
    const lang = (opts.lang || '1,2').trim();
    const useFixie = opts.useFixie !== false;

    const p1 = process.env.RESALES_P1;
    const p2 = process.env.RESALES_P2;
    if (!p1 || !p2) throw new Error('fetchPropertyDetails: RESALES_P1/P2 not set');
    const filterId = opts.filterId || process.env.RESALES_FILTER_ID || '1';

    const url = new URL(RESALES_BASE + '/PropertyDetails');
    url.searchParams.set('p1', p1);
    url.searchParams.set('p2', p2);
    url.searchParams.set('P_RefId', reference);
    url.searchParams.set('p_Lang', lang);
    url.searchParams.set('p_agency_filterid', filterId);

    const fetchOptions = { headers: { 'Accept': 'application/json' } };
    if (useFixie && process.env.FIXIE_URL) {
        fetchOptions.dispatcher = new ProxyAgent(process.env.FIXIE_URL);
    }

    await throttle();
    const res = await undiciFetch(url.toString(), fetchOptions);
    const text = await res.text();

    let data;
    try { data = JSON.parse(text); }
    catch (e) {
        throw new Error('PropertyDetails: non-JSON upstream response (' + res.status + '): ' + text.slice(0, 200));
    }

    // The upstream always returns 200 even on errors — surface the
    // transaction.status block so callers can halt on auth issues.
    if (data && data.transaction && data.transaction.status === 'error') {
        const err = data.transaction.errordescription || {};
        const codes = Object.keys(err).join(',');
        const e = new Error('PropertyDetails error codes ' + codes + ': ' +
            Object.values(err).join('; '));
        e.errorCodes = err;
        e.upstreamStatus = res.status;
        throw e;
    }

    if (!data || !data.Property) {
        // success status but no Property — deleted / non-existent ref.
        return null;
    }
    return data.Property;
}

// ── Field extractors / coercers ──────────────────────────────
//
// These translate raw PropertyDetails fields into the shapes the rest of
// the codebase expects. Kept close to the client so the sync mapper can
// import them without duplicating parsing logic.

/**
 * Parse "1,368" / "2,820" / "0" / "" → integer or null.
 * Resales uses comma thousand-separators; we strip them.
 */
function parseFeeNumber(s) {
    if (s == null) return null;
    const clean = String(s).replace(/[, ]/g, '').trim();
    if (!clean || clean === '0') return null; // "0" means "not provided"
    const n = parseInt(clean, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse BuiltYear → integer or null. "Unknown" / "" / "0" → null.
 */
function parseBuiltYear(s) {
    if (s == null) return null;
    const v = String(s).trim();
    if (!v || /^unknown$/i.test(v) || v === '0') return null;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return null;
    if (n < 1800 || n > new Date().getFullYear() + 5) return null;
    return n;
}

/**
 * Pull the array of /w1200/ photo URLs from PropertyDetails.Pictures.
 * Returns [] when no pictures are present.
 */
function extractHighResImages(property) {
    const pics = property && property.Pictures && property.Pictures.Picture;
    if (!pics) return [];
    const arr = Array.isArray(pics) ? pics : [pics];
    return arr.map(p => p && p.PictureURL).filter(Boolean);
}

/**
 * Extract the count from PropertyDetails.Pictures.Count, with array-length
 * fallback when the field is missing.
 */
function extractImagesCount(property) {
    if (!property || !property.Pictures) return 0;
    const declared = parseInt(property.Pictures.Count, 10);
    if (Number.isFinite(declared) && declared > 0) return declared;
    return extractHighResImages(property).length;
}

/**
 * Extract description in a target language from the bilingual
 * PropertyDetails.Description object. Falls back to the other language
 * if the requested one is empty.
 */
function extractDescription(property, lang) {
    const d = property && property.Description;
    if (!d) return '';
    if (typeof d === 'string') return d;
    const want = (lang === 'en') ? 'en' : 'es';
    const other = want === 'en' ? 'es' : 'en';
    return (d[want] && d[want].trim()) || (d[other] && d[other].trim()) || '';
}

/**
 * Extract the EnergyRating subobject. Always returns a normalized shape
 * even when the upstream omits fields or returns empty strings.
 */
function extractEnergyRating(property) {
    const e = property && property.EnergyRating;
    if (!e) return null;
    const out = {
        co2_rated: (e.CO2Rated || '').trim() || null,
        co2_value: (e.CO2Value || '').toString().trim() || null,
        energy_rated: (e.EnergyRated || '').trim() || null,
        energy_value: (e.EnergyValue || '').toString().trim() || null,
        image: (e.Image || '').trim() || null
    };
    // If every field is null, return null instead of an empty shell.
    if (!out.co2_rated && !out.co2_value && !out.energy_rated && !out.energy_value && !out.image) {
        return null;
    }
    return out;
}

module.exports = {
    fetchPropertyDetails,
    parseFeeNumber,
    parseBuiltYear,
    extractHighResImages,
    extractImagesCount,
    extractDescription,
    extractEnergyRating
};
