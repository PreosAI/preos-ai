// Location triangulation pipeline (Phase A, Checkpoint 2 — v3).
//
// Pipeline:
//   1. LLM signal extraction (Claude Haiku 4.5) over the listing description
//      and metadata.
//   2. Three-strike municipality verification (the v3 fix). Find a coord
//      that lands in the cadastre's expected municipality:
//        Strike 1: cadastre at the existing Mapbox coord.
//        Strike 2: cadastre at "{city}, Costa del Sol, Spain" centroid.
//        Strike 3: cadastre at "{city}, {area}, Costa del Sol, Spain" centroid.
//      Each strike has a tier_floor cap — strike 2 capped at 'medium', strike
//      3 capped at 'low'. All three failed → 'rejected'. Cadastre metadata
//      match score ≥ 50 still promotes to 'exact' regardless of strike.
//   3. LLM landmark resolution with the verified anchor (5 km gate). The
//      gate now operates against a known-correct municipality coord, so it
//      filters bad Mapbox same-named-place misresolutions without locking
//      us to a wrong starting position (the v2 failure mode).
//   4. Compute candidate from validated landmarks (centroid for ≥2, else
//      preserve the verified anchor).
//   5. Final cadastre check at the candidate (re-using strike 1 parcels
//      when the candidate equals the strike-1 anchor).
//   6. Assign tier with tier_floor enforcement.
//
// Apartment buildings: still no <lcons> drill-down for unit-level m²/year.
// OSM polygon constraint still deferred. Both tracked as Phase B work.

const { lookupByCoords, matchParcelToListing } = require('./cadastre');
const { callMessagesText, stripJsonFence } = require('./anthropic');
const { getExpectedMunicipality, municipalityMatches } = require('./city-municipality-map');

const MAPBOX_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places/';
const MALAGA_BBOX = { north: 37.30, south: 36.30, west: -5.55, east: -4.20 };
const MAPBOX_THROTTLE_MS = 200;
let _mapboxLastAt = 0;

// In-process landmark cache for the duration of a batch run. Phase A
// Checkpoint 3 will replace this with a Firestore-backed cache keyed by
// `landmark_cache/{normName}`. For Checkpoint 2 (50-property test) we keep
// it in-memory — duplicates within a batch still get the cache-hit win.
const _landmarkCache = new Map();

// ── System prompt: cached on first call, reused by the rest of the batch ──

const SYSTEM_PROMPT = [
    'You are a Costa del Sol real estate location expert. Given a property listing, extract every',
    'signal that could narrow its physical location. Return JSON only — no markdown fences, no',
    'commentary, no preamble.',
    '',
    'CRITICAL — landmarks_mentioned and adjacent_landmarks must contain ONLY specific, named,',
    'searchable places. A valid landmark is a proper noun that a person could find on Google Maps:',
    '  ✓ "Aloha Golf", "Don Carlos Hotel", "Plaza Mayor", "Puerto Banús", "Nikki Beach Club",',
    '    "La Cañada Shopping Centre", "Marbella Club", "Trocadero", "Selwo Aventura"',
    '  ✗ Generic terms — DO NOT include any of these:',
    '    "the beach", "sandy beaches", "the sea", "playa", "mar"',
    '    "shops", "restaurants", "tiendas", "restaurantes"',
    '    "golf course" (without name), "tennis club" (without name)',
    '    "the park", "national park", "parque nacional", "parque natural"',
    '    "mountain", "forest", "montaña", "bosque"',
    '    "school", "supermarket", "pharmacy", "church"',
    '  If the listing says "close to the beach" with no named beach, OMIT it. Only include a beach',
    '  if it is a NAMED beach (e.g. "Carib Playa", "Playa de Cabopino"). Same rule for golf, tennis,',
    '  parks, plazas, etc.',
    '',
    'For each landmark you DO include, only state a distance if the listing gives a specific number',
    '(metres, km, minutes drive). Vague phrases ("stones throw", "moments away") set distance to null.',
    '',
    'Other extracted fields:',
    ' - urbanization_phase: name of the urbanization or its phase ("La Mairena", "Sierra Blanca',
    '   Phase 2"). Set null if not stated.',
    ' - building_name: development / building name ("Residencial Las Cumbres"). Null if not stated.',
    ' - street_fragments: street names if mentioned ("Calle Ramiro Campos").',
    ' - directional_cues: orientation, view direction, elevation cues.',
    ' - developer_or_project: name of the developer or project.',
    ' - year_built_extracted: integer year of original construction if explicitly stated, null',
    '   otherwise. confidence: explicit | inferred | renovated | null.',
    ' - other_signals: anything else useful that doesnt fit elsewhere.',
    '',
    'Return the EXACT JSON structure the user requests. Use empty arrays and null when no signal',
    'exists. Be conservative — only extract what is explicitly stated. Never invent.'
].join('\n');

const USER_TEMPLATE = (l) => [
    'Listing metadata:',
    '- city: ' + (l.city || ''),
    '- area: ' + (l.area || ''),
    '- location: ' + (l.location || ''),
    '- subLocation: ' + (l.neighbourhood || l.subLocation || ''),
    '- bedrooms: ' + (l.bedrooms || ''),
    '- bathrooms: ' + (l.bathrooms || ''),
    '- m2_built: ' + (l.size_m2 || ''),
    '- m2_plot: ' + (l.plot_m2 || ''),
    '- m2_terrace: ' + (l.terrace_m2 || ''),
    '- type: ' + (l.type || ''),
    '- features: ' + ((l.features || []).slice(0, 30).join(', ')),
    '',
    'Description (Spanish):',
    (l.description_es || '').slice(0, 4000),
    '',
    'Description (English):',
    (l.description_en || '').slice(0, 4000),
    '',
    'Extract location signals and return this exact JSON structure:',
    '{',
    '  "landmarks_mentioned": [{"name": "...", "distance": "...", "direction": "..."}],',
    '  "urbanization_phase": "... or null",',
    '  "building_name": "... or null",',
    '  "street_fragments": ["..."],',
    '  "directional_cues": {"orientation": "...", "views": "...", "elevation": "..."},',
    '  "adjacent_landmarks": ["..."],',
    '  "developer_or_project": "... or null",',
    '  "year_built_extracted": null,',
    '  "year_built_extracted_confidence": null,',
    '  "other_signals": ["..."]',
    '}',
    '',
    'Confidence semantics for year_built_extracted_confidence:',
    ' - "explicit" : description states the build year directly',
    ' - "inferred" : description references an era ("1970s build", "boom years")',
    ' - "renovated": description states a renovation year only',
    ' - null       : no year signal'
].join('\n');

// ── Mapbox landmark resolution ────────────────────────────────

async function mapboxThrottle() {
    const now = Date.now();
    const wait = _mapboxLastAt + MAPBOX_THROTTLE_MS - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _mapboxLastAt = Date.now();
}

function normLandmark(s) {
    if (!s) return '';
    return String(s).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Defence-in-depth: reject landmark tokens that have no proper-noun anchor
// — i.e. that are JUST a generic place-type word with at most a generic
// qualifier ("the beach", "sandy beaches", "private beach"). Phase A.5
// audit found the previous endsWith() check was over-aggressive: it
// rejected "Aloha Golf Course" / "Don Carlos Hotel" / "Guadalmina Baja
// Golf Course" because they ended in a generic suffix, even though the
// proper-noun PREFIX makes them perfectly geocodable.
//
// New gate: reject only when the WHOLE string matches /^<qualifier?>
// <generic>$/ — the landmark contains nothing else.
const GENERIC_PLACE_WORDS = [
    'beach', 'beaches', 'sea', 'seafront', 'coast', 'coastline',
    'shop', 'shops', 'shopping', 'shopping centre', 'shopping center',
    'golf', 'golf course', 'golf courses',
    'tennis', 'tennis court', 'tennis courts', 'padel court', 'padel courts',
    'park', 'parks', 'national park', 'natural park',
    'parque nacional', 'parque natural', 'parque nacional protegido', 'parque protegido',
    'mountain', 'mountains', 'forest', 'forests',
    'school', 'schools', 'university',
    'supermarket', 'supermarkets', 'pharmacy', 'church', 'churches',
    'hospital', 'hospitals',
    'town centre', 'town center', 'city centre', 'city center', 'town', 'pueblo',
    'beach club', 'restaurant', 'restaurants', 'restaurants and bars', 'bars',
    'gym', 'gyms', 'plaza', 'plazas',
    // Spanish equivalents — same idea
    'playa', 'playas', 'mar', 'tienda', 'tiendas', 'restaurante', 'restaurantes',
    'parque', 'iglesia', 'colegio', 'farmacia', 'supermercado',
    'montana', 'montanas', 'bosque', 'campo de golf', 'centro', 'centro comercial'
];

// Words that NEVER make a generic landmark "named" — they're descriptive
// adjectives or articles. e.g. "the beach", "sandy beaches", "lovely beach".
const GENERIC_QUALIFIER_WORDS = [
    'the', 'a', 'an', 'la', 'el', 'los', 'las',
    'sandy', 'rocky', 'secluded', 'private', 'public', 'beautiful', 'lovely',
    'nearby', 'local', 'small', 'big', 'main', 'old', 'new'
];

const _GENERIC_PLACE_RE = (function () {
    const places = GENERIC_PLACE_WORDS.map(w => w.replace(/\s+/g, '\\s+'))
        .sort((a, b) => b.length - a.length).join('|');
    const quals = GENERIC_QUALIFIER_WORDS.join('|');
    // Whole-string match: optional qualifier + generic word.
    return new RegExp('^(?:(?:' + quals + ')\\s+)?(?:' + places + ')$', 'i');
})();

function isGenericLandmark(name) {
    if (!name) return true;
    const n = normLandmark(name);
    if (n.length < 4) return true;
    if (/^(close to|near|next to)\b/.test(n)) return true;
    return _GENERIC_PLACE_RE.test(n);
}

function inBbox(lat, lng) {
    return lat >= MALAGA_BBOX.south && lat <= MALAGA_BBOX.north &&
           lng >= MALAGA_BBOX.west && lng <= MALAGA_BBOX.east;
}

// Anchor distance gate: a resolved landmark must be within ANCHOR_MAX_DIST_M
// of the listing's existing coordinate. This is the safety net against
// Mapbox returning a same-named place hundreds of km away (the actual
// failure mode in the first 50-property run was Mapbox resolving "Parque
// Nacional protegido" / "sandy beaches" to a Cl Mairena street in
// Torremolinos because nothing closer matched the term).
const ANCHOR_MAX_DIST_M = 5000;

async function resolveLandmark(name, biasCity, mapboxToken, anchor, cache) {
    if (!name) return null;
    const key = normLandmark(name);

    function applyAnchorGate(resolved) {
        if (!resolved) return null;
        if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
            const dist = haversineMeters(anchor.lat, anchor.lng, resolved.lat, resolved.lng);
            if (dist > ANCHOR_MAX_DIST_M) return null;
        }
        return resolved;
    }

    // In-memory cache (per-invocation).
    if (_landmarkCache.has(key)) {
        return applyAnchorGate(_landmarkCache.get(key));
    }
    // Firestore-backed cache (cross-invocation).
    if (cache) {
        const fromCache = await cache.getLandmark(key);
        if (fromCache !== undefined) {
            _landmarkCache.set(key, fromCache);
            return applyAnchorGate(fromCache);
        }
    }

    const search = (biasCity ? name + ', ' + biasCity : name) + ', Málaga, Spain';
    // proximity: prefer anchor coord when available — gives Mapbox a much
    // better chance of returning the right named place out of multiple
    // same-named candidates.
    const proximity = (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng))
        ? anchor.lng + ',' + anchor.lat
        : '-4.7,36.5';
    const url = MAPBOX_BASE + encodeURIComponent(search) + '.json?' + new URLSearchParams({
        access_token: mapboxToken,
        country: 'es',
        language: 'es',
        types: 'poi,place,locality,neighborhood',
        proximity,
        bbox: [MALAGA_BBOX.west, MALAGA_BBOX.south, MALAGA_BBOX.east, MALAGA_BBOX.north].join(','),
        limit: '1'
    }).toString();

    await mapboxThrottle();
    let res;
    try {
        res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    } catch (e) {
        _landmarkCache.set(key, null);
        if (cache) cache.setLandmark(key, null);
        return null;
    }
    if (!res.ok) {
        _landmarkCache.set(key, null);
        if (cache) cache.setLandmark(key, null);
        return null;
    }
    const data = await res.json();
    if (!data.features || data.features.length === 0) {
        _landmarkCache.set(key, null);
        if (cache) cache.setLandmark(key, null);
        return null;
    }
    const f = data.features[0];
    const [lng, lat] = f.center || [];
    if (!inBbox(lat, lng)) {
        _landmarkCache.set(key, null);
        if (cache) cache.setLandmark(key, null);
        return null;
    }
    const out = {
        name,
        normName: key,
        lat, lng,
        place_name: f.place_name,
        relevance: f.relevance
    };
    _landmarkCache.set(key, out);
    if (cache) cache.setLandmark(key, out);
    return applyAnchorGate(out);
}

// ── City centroid resolver (used by strike 2 and 3) ───────────

const _cityCentroidCache = new Map();

async function resolveCityCentroid(searchText, mapboxToken, types, cache) {
    if (!searchText) return null;
    const cacheKey = searchText + '|' + (types || '');
    if (_cityCentroidCache.has(cacheKey)) return _cityCentroidCache.get(cacheKey);
    if (cache) {
        const fromCache = await cache.getCityCentroid(cacheKey);
        if (fromCache !== undefined) {
            _cityCentroidCache.set(cacheKey, fromCache);
            return fromCache;
        }
    }

    const url = MAPBOX_BASE + encodeURIComponent(searchText) + '.json?' + new URLSearchParams({
        access_token: mapboxToken,
        country: 'es',
        language: 'es',
        types: types || 'place,locality,neighborhood',
        proximity: '-4.7,36.5',
        bbox: [MALAGA_BBOX.west, MALAGA_BBOX.south, MALAGA_BBOX.east, MALAGA_BBOX.north].join(','),
        limit: '1'
    }).toString();

    await mapboxThrottle();
    let res;
    try {
        res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    } catch (e) {
        _cityCentroidCache.set(searchText, null);
        return null;
    }
    if (!res.ok) {
        _cityCentroidCache.set(cacheKey, null);
        if (cache) cache.setCityCentroid(cacheKey, null);
        return null;
    }
    const data = await res.json();
    if (!data.features || data.features.length === 0) {
        _cityCentroidCache.set(cacheKey, null);
        if (cache) cache.setCityCentroid(cacheKey, null);
        return null;
    }
    const f = data.features[0];
    const [lng, lat] = f.center || [];
    if (!inBbox(lat, lng)) {
        _cityCentroidCache.set(cacheKey, null);
        if (cache) cache.setCityCentroid(cacheKey, null);
        return null;
    }
    const out = { lat, lng, place_name: f.place_name, relevance: f.relevance };
    _cityCentroidCache.set(cacheKey, out);
    if (cache) cache.setCityCentroid(cacheKey, out);
    return out;
}

// ── Three-strike municipality resolution ──────────────────────

/**
 * Walk strikes 1 → 3 to find a coord that lands in the listing's expected
 * cadastre municipality. Returns:
 *   {
 *     anchor: { lat, lng } | null,
 *     parcels: [...] from the cadastre call at anchor (so we don't re-call later),
 *     strike: 1 | 2 | 3 | null,
 *     tier_floor: null | 'medium' | 'low' | 'rejected',
 *     trace: { expected_municipality, strikes: [...] }
 *   }
 *
 * tier_floor caps the maximum tier the rest of the pipeline can assign,
 * EXCEPT that a cadastre metadata match (score ≥ 50) at the chosen anchor
 * still promotes to 'exact' regardless of which strike won.
 */
async function resolveValidMunicipalityAnchor(listing, mapboxToken, cache) {
    const expectedMuni = getExpectedMunicipality(listing.city);
    const trace = { expected_municipality: expectedMuni, strikes: [] };

    async function tryStrike(label, coord, source, tierFloor) {
        if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lng) || !inBbox(coord.lat, coord.lng)) {
            trace.strikes.push({ strike: label, source, coord: coord || null, parcels_returned: 0, matched: false, reason: 'no-coord' });
            return null;
        }
        let parcels = [];
        try { parcels = await lookupByCoords(coord.lat, coord.lng, cache); } catch (e) {
            trace.strikes.push({ strike: label, source, coord, parcels_returned: 0, matched: false, error: e.message });
            return null;
        }
        const closestAddr = parcels[0] ? parcels[0].address : '';
        const matched = municipalityMatches(closestAddr, expectedMuni);
        trace.strikes.push({
            strike: label, source, coord,
            parcels_returned: parcels.length,
            closest_address: closestAddr,
            matched
        });
        if (matched) {
            return { anchor: coord, parcels, strike: label, tier_floor: tierFloor, source };
        }
        return null;
    }

    // Strike 1: existing Mapbox coord.
    const s1coord = (Number.isFinite(listing.lat) && Number.isFinite(listing.lng))
        ? { lat: listing.lat, lng: listing.lng } : null;
    const s1 = await tryStrike(1, s1coord, 'existing-mapbox', null);
    if (s1) return { ...s1, trace };

    // Strike 2: re-geocode "{city}, {expected_municipality}, Spain". Adding the
    // municipality disambiguates urbanizations whose Mapbox entry is wrongly
    // tagged to Málaga city (Marbesa, The Golden Mile, Carib Playa, etc.).
    if (expectedMuni) {
        const s2search = (listing.city || '').trim() + ', ' + expectedMuni + ', Spain';
        const s2coord = await resolveCityCentroid(s2search, mapboxToken, undefined, cache);
        const s2 = await tryStrike(2, s2coord, 'mapbox-city-in-muni', 'medium');
        if (s2) return { ...s2, trace };
    }

    // Strike 3: pure municipality centroid — "{expected_municipality}, Spain".
    // Guaranteed-correct fallback for stubborn urbanizations (e.g. "Las Chapas"
    // which Mapbox insists on placing in Málaga city even when "Marbella" is
    // in the search text). Coord lands at the municipality centre.
    if (expectedMuni) {
        const s3search = expectedMuni + ', Spain';
        const s3coord = await resolveCityCentroid(s3search, mapboxToken, 'place,locality', cache);
        const s3 = await tryStrike(3, s3coord, 'mapbox-municipality-centroid', 'low');
        if (s3) return { ...s3, trace };
    }

    return { anchor: null, parcels: [], strike: null, tier_floor: 'rejected', source: 'rejected', trace };
}

// ── Distance parsing ──────────────────────────────────────────

function parseDistanceMeters(s) {
    if (!s) return null;
    const t = String(s).toLowerCase().replace(',', '.');
    const m = t.match(/([\d.]+)\s*(km|kms|kilometers|kilómetros|kilometres|m|meters|metres|metros)?/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    const unit = (m[2] || 'm').toLowerCase();
    if (unit.startsWith('k')) return n * 1000;
    return n;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Candidate coord computation ──────────────────────────────

// Phase A.5 point #2 — landmark-vs-anchor cross-check.
//
// If ≥1 landmark resolves AND the centroid of resolved landmarks is
// >500 m from the Mapbox anchor, the anchor is suspect (R4649410-class
// failure where Mapbox places the listing in roughly the right area but
// off by ~1 km, and only landmark triangulation can move it). Re-anchor
// to the landmark centroid before cadastre lookup. ≤500 m means the
// landmarks corroborate the anchor; trust the (more stable) anchor coord.
//
// Both candidates are logged to candidates_considered for audit so the
// reasoning trace shows the disagreement (if any).
const LANDMARK_DISAGREEMENT_THRESHOLD_M = 500;

function computeCandidate(anchor, signals, resolved) {
    const valid = (resolved || []).filter(r => r && Number.isFinite(r.lat) && Number.isFinite(r.lng));
    const hasAnchor = anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng) && inBbox(anchor.lat, anchor.lng);

    if (valid.length >= 1 && hasAnchor) {
        const cLat = valid.reduce((s, r) => s + r.lat, 0) / valid.length;
        const cLng = valid.reduce((s, r) => s + r.lng, 0) / valid.length;
        const dist = Math.round(haversineMeters(anchor.lat, anchor.lng, cLat, cLng));
        const candidatesAudit = [
            { lat: anchor.lat, lng: anchor.lng, source: 'anchor', label: 'mapbox-anchor' },
            { lat: cLat, lng: cLng, source: 'landmark_centroid', label: 'landmark-centroid', n_landmarks: valid.length }
        ];

        if (dist > LANDMARK_DISAGREEMENT_THRESHOLD_M) {
            // Landmarks disagree with the anchor — trust landmarks.
            return {
                lat: cLat, lng: cLng,
                source: 'landmark_centroid_reanchored',
                score: Math.min(95, 70 + valid.length * 5),
                inputs: valid.map(v => v.name),
                centroid_vs_anchor_m: dist,
                candidates_considered: candidatesAudit
            };
        }
        // Within threshold → landmarks corroborate the anchor; use the anchor
        // (it's typically more precise than a 1-2 landmark centroid).
        return {
            lat: anchor.lat, lng: anchor.lng,
            source: 'anchor_corroborated_by_landmarks',
            score: Math.min(90, 60 + valid.length * 10),
            inputs: ['anchor'].concat(valid.map(v => v.name)),
            centroid_vs_anchor_m: dist,
            candidates_considered: candidatesAudit
        };
    }

    // Has anchor, no landmarks → preserve the anchor as-is.
    if (hasAnchor) {
        return {
            lat: anchor.lat, lng: anchor.lng,
            source: 'anchor_preserved',
            score: 40,
            inputs: ['anchor']
        };
    }

    // No anchor + landmarks resolved → use the landmark centroid as our only
    // signal. (Should be rare given strikes 1-3 always try to produce an
    // anchor.)
    if (valid.length >= 2) {
        const lat = valid.reduce((s, r) => s + r.lat, 0) / valid.length;
        const lng = valid.reduce((s, r) => s + r.lng, 0) / valid.length;
        return {
            lat, lng,
            source: 'landmark_centroid',
            score: Math.min(95, 70 + valid.length * 5),
            inputs: valid.map(v => v.name)
        };
    }
    if (valid.length === 1) {
        return {
            lat: valid[0].lat, lng: valid[0].lng,
            source: 'single_landmark',
            score: 60,
            inputs: [valid[0].name]
        };
    }
    return null;
}

// ── Cadastre cross-validation ─────────────────────────────────

function buildCrossValidationTokens(signals) {
    const tokens = [];
    if (signals.urbanization_phase) tokens.push(normLandmark(signals.urbanization_phase));
    if (signals.building_name) tokens.push(normLandmark(signals.building_name));
    (signals.street_fragments || []).forEach(s => { if (s) tokens.push(normLandmark(s)); });
    (signals.landmarks_mentioned || []).forEach(l => { if (l && l.name) tokens.push(normLandmark(l.name)); });
    return tokens.filter(t => t && t.length >= 4);
}

async function cadastreVerify(candidate, listing, signals, prefetchedParcels, cache) {
    if (!candidate) return null;
    let parcels = prefetchedParcels;
    if (!parcels) {
        try {
            parcels = await lookupByCoords(candidate.lat, candidate.lng, cache);
        } catch (e) {
            return { error: 'cadastre lookup failed: ' + e.message };
        }
    }
    if (!parcels || parcels.length === 0) {
        return { coords_queried: { lat: candidate.lat, lng: candidate.lng }, parcels_returned: 0 };
    }

    const listingMeta = {
        m2_built: listing.size_m2 || null,
        year_built: signals.year_built_extracted || null,
        year_built_confidence: signals.year_built_extracted_confidence || null,
        type: listing.type
    };
    const match = await matchParcelToListing(parcels, listingMeta, { maxParcels: 3, cache });

    // Cross-validation: does the closest parcel's address contain LLM-extracted tokens?
    const closestAddr = normLandmark(parcels[0].address || '');
    const tokens = buildCrossValidationTokens(signals);
    const matchedTokens = tokens.filter(tok => closestAddr.includes(tok));
    let addressMatch = 'unknown';
    if (tokens.length === 0) addressMatch = 'no-tokens';
    else if (matchedTokens.length > 0) addressMatch = 'match';
    else addressMatch = 'no-match';

    return {
        coords_queried: { lat: candidate.lat, lng: candidate.lng },
        parcels_returned: parcels.length,
        closest_parcel: { refcat: parcels[0].refcat, distance: parcels[0].distance, address: parcels[0].address },
        best_match: match.match,
        candidates_inspected: match.candidates ? match.candidates.length : 0,
        address_check: { tokens, matched: matchedTokens, result: addressMatch }
    };
}

// ── Tier assignment ──────────────────────────────────────────

const TIER_RANK = { rejected: 0, low: 1, medium: 2, high: 3, exact: 4 };

function capTier(tier, floor) {
    if (!floor) return tier;
    return TIER_RANK[tier] <= TIER_RANK[floor] ? tier : floor;
}

// Property-type whitelist for exact tier (Phase A.5).
//
// Cadastre metadata-match alone isn't sufficient to claim exact for non-
// residential listings — m² agreement between a listing and a same-area
// commercial / land / parking parcel can be coincidental, and the consequence
// of a false 'exact' on a non-dwelling is more visible than on a residential
// (e.g. a Storage Room rendered as a verified pin on the map).
//
// Any of the following keywords appearing in propertyType / subtype / the
// normalized type allows exact tier; the blocklist takes precedence.
const RESIDENTIAL_TYPE_KEYWORDS = [
    'villa', 'chalet',
    'apartment', 'flat', 'apartamento',
    'townhouse', 'semi-detached', 'semidetached', 'adosado',
    'penthouse', 'atico', 'ático',
    'studio', 'estudio',
    'duplex', 'dúplex',
    'house', 'casa',
    'finca', 'cortijo'
];
const NON_RESIDENTIAL_TYPE_BLOCKLIST = [
    'storage', 'garage', 'parking', 'aparcamiento',
    'plot', 'land', 'solar', 'parcela',
    'cave',
    'commercial', 'comercial', 'local',
    'restaurant', 'restaurante',
    'shop', 'tienda',
    'office', 'oficina',
    'hotel', 'hostel',
    'bar',
    'apartment complex', 'building', 'edificio'
];

function isExactEligibleType(rawType, rawSubtype, normalizedType) {
    const text = ((rawType || '') + ' ' + (rawSubtype || '') + ' ' + (normalizedType || ''))
        .toLowerCase();
    if (!text.trim()) return false;
    for (const block of NON_RESIDENTIAL_TYPE_BLOCKLIST) {
        if (text.includes(block)) return false;
    }
    for (const allow of RESIDENTIAL_TYPE_KEYWORDS) {
        if (text.includes(allow)) return true;
    }
    return false;
}

function assignTier(candidate, cadastreResult, signals, resolved, listing, tierFloor, muniSource) {
    if (!candidate) {
        return {
            lat: null, lng: null,
            tier: 'rejected', source: 'rejected',
            score: 0,
            reason: 'No candidate coord — municipality verification failed (3 strikes).'
        };
    }

    let score = candidate.score || 0;
    const reasons = ['candidate=' + candidate.source + ' base=' + score];
    if (tierFloor) reasons.push('tier_floor=' + tierFloor + ' (from strike fallback)');

    if (cadastreResult && !cadastreResult.error) {
        // Address-token cross-check. The +15 bonus applies when the LLM-
        // extracted urbanization / building / street tokens DO appear in the
        // cadastre's closest parcel address — that's a real signal we landed
        // on the right block. The mismatch case is no longer penalised:
        // post-backfill audit showed it produced 33% false rejections,
        // because Mapbox's existing-coord strike-1 placements often land at
        // a city/locality centroid whose cadastre address is a city-centre
        // street that obviously doesn't carry urbanization-specific tokens.
        // The strike system already validates municipality, which is the
        // signal that actually matters.
        if (cadastreResult.address_check && cadastreResult.address_check.result === 'match') {
            score += 15;
            reasons.push('cadastre-address-tokens-match +15');
        } else if (cadastreResult.address_check && cadastreResult.address_check.result === 'no-match') {
            reasons.push('cadastre-address-tokens-mismatch (no penalty applied — centroid placements)');
        }

        // Cadastre metadata match → exact tier promotion. Restricted to
        // strike-1 anchors because strike-2/3 centroids are city/municipality
        // centres; a metadata match THERE is most likely coincidental (lots
        // of parcels at any city centre, one of them is bound to share a m²
        // value with the listing). For strike-2/3 anchors we suppress the
        // promotion AND the score nudge — a centroid placement is honestly
        // 'low' tier regardless of any coincidental cadastre fit. The
        // metadata match might still be useful as informational metadata
        // (we keep it in the trace), just not as a confidence signal.
        if (cadastreResult.best_match && (cadastreResult.best_match.score || 0) >= 50) {
            if (!tierFloor) {
                // Phase A.5 type-eligibility gate. Non-residential types
                // (Storage Room, Garage, Plot, Restaurant, etc.) cannot
                // claim exact regardless of cadastre score — m² agreement
                // with a same-area commercial / land parcel is plausibly
                // coincidental and the rendering cost of a false-exact on
                // a non-dwelling is more visible to users.
                const eligibleForExact = isExactEligibleType(
                    listing.rawPropertyType, listing.rawSubtype, listing.type);
                // Phase A.5 point #3 — exact-cap on token mismatch.
                // R4649410-class: strike-1 cadastre m² match without LLM-
                // extracted urbanization/street tokens corroborating the
                // address is plausibly a coincidental match in the same
                // urbanization. Cap at 'high' instead.
                const tokenMismatch = cadastreResult.address_check &&
                    cadastreResult.address_check.result === 'no-match';

                if (eligibleForExact && !tokenMismatch) {
                    return {
                        lat: candidate.lat, lng: candidate.lng,
                        tier: 'exact',
                        source: 'cadastre_verified',
                        score: Math.min(100, score + 25),
                        reason: reasons.concat([
                            'cadastre metadata match score=' + cadastreResult.best_match.score,
                            'refcat=' + cadastreResult.best_match.refcat,
                            'strike-1 anchor → exact'
                        ]).join(' · ')
                    };
                }
                if (eligibleForExact && tokenMismatch) {
                    // Tokens present but don't appear in cadastre's address →
                    // exact promotion is too aggressive. Land at 'high' with
                    // a smaller score boost.
                    return {
                        lat: candidate.lat, lng: candidate.lng,
                        tier: 'high',
                        source: 'cadastre_verified_capped',
                        score: Math.min(85, score + 10),
                        reason: reasons.concat([
                            'cadastre metadata match score=' + cadastreResult.best_match.score,
                            'refcat=' + cadastreResult.best_match.refcat,
                            'address_token_match=false → cap at high (Phase A.5 #3)'
                        ]).join(' · ')
                    };
                }
                // Non-residential — suppress the exact promotion and cap
                // tier at medium so the score-based logic below can't push
                // above medium even with strong landmarks/address tokens.
                const t = listing.rawPropertyType || listing.type || 'unknown';
                reasons.push('type_not_eligible_for_exact: ' + t);
                tierFloor = 'medium';
            } else {
                reasons.push('cadastre metadata match score=' + cadastreResult.best_match.score +
                    ' on strike-' + (tierFloor === 'medium' ? '2' : '3') +
                    ' anchor — score nudge suppressed (centroid placement, coincidental match risk)');
            }
        }
    }

    // Tier from confidence score.
    let tier, source;
    if (score >= 75) {
        tier = 'high';
        source = (resolved && resolved.length > 0) ? 'landmark_triangulation' : 'mapbox_with_cross_validation';
    } else if (score >= 50) {
        tier = 'medium';
        source = (resolved && resolved.length > 0) ? 'landmark_triangulation' : 'mapbox_fallback';
    } else if (score >= 30) {
        tier = 'low';
        source = 'mapbox_fallback';
    } else {
        tier = 'rejected';
        source = 'rejected';
    }

    // Apply tier_floor cap (strike 2 → max medium, strike 3 → max low).
    const cappedTier = capTier(tier, tierFloor);
    if (cappedTier !== tier) {
        reasons.push('capped to ' + cappedTier + ' by tier_floor');
        tier = cappedTier;
    }

    // Surface the strike source so we can audit which path each property took.
    if (muniSource && tier !== 'rejected') {
        source = source + ' · ' + muniSource;
    }

    if (tier === 'rejected') {
        return {
            lat: null, lng: null,
            tier, source, score,
            reason: reasons.concat(['final score below 30, rejecting']).join(' · ')
        };
    }
    return {
        lat: candidate.lat, lng: candidate.lng,
        tier, source, score,
        reason: reasons.join(' · ')
    };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Extract location signals from a listing using Claude Haiku 4.5.
 * Returns a parsed JSON object matching the schema documented in
 * USER_TEMPLATE. Fields default to empty arrays / null if absent.
 *
 * Throws on Anthropic API errors — caller halts the batch (per Phase A
 * "no silent fallback" rule).
 */
async function extractSignals(listing) {
    const { text, usage } = await callMessagesText({
        system: SYSTEM_PROMPT,
        user: USER_TEMPLATE(listing),
        maxTokens: 1000,
        temperature: 0,
        cacheSystem: true
    });
    const cleaned = stripJsonFence(text);
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (e) {
        throw new Error('Haiku returned non-JSON for ' + listing.id + ': ' + cleaned.slice(0, 300));
    }
    return { signals: parsed, usage };
}

/**
 * Main pipeline: returns
 *   { lat, lng, locationConfidence, locationSource, reasoning_trace,
 *     year_built_seed, usage }
 */
async function triangulateLocation(listing, opts) {
    const { mapboxToken, cache = null } = opts || {};
    if (!mapboxToken) throw new Error('triangulateLocation: mapboxToken is required');

    const trace = {
        signals_extracted: null,
        municipality_resolution: null,
        landmarks_resolved: [],
        candidates_considered: [],
        cadastre_check: null,
        final_confidence_score: 0,
        final_decision_reason: ''
    };

    // 1. LLM signal extraction.
    const { signals, usage } = await extractSignals(listing);
    trace.signals_extracted = signals;

    // 2. Three-strike municipality resolution. Find a coord that lands in
    // the cadastre's expected municipality before we trust any landmark
    // refinement.
    const muniResult = await resolveValidMunicipalityAnchor(listing, mapboxToken, cache);
    trace.municipality_resolution = muniResult.trace;
    if (!muniResult.anchor) {
        trace.final_confidence_score = 0;
        trace.final_decision_reason = 'all 3 strikes failed to land in expected municipality';
        return {
            lat: null, lng: null,
            locationConfidence: 'rejected',
            locationSource: 'rejected',
            reasoning_trace: trace,
            year_built_seed: null,
            year_built_extracted: signals.year_built_extracted || null,
            year_built_extracted_confidence: signals.year_built_extracted_confidence || null,
            usage
        };
    }
    const anchor = muniResult.anchor;

    const landmarkRefs = [];
    for (const l of (signals.landmarks_mentioned || [])) {
        if (l && l.name) landmarkRefs.push({ name: l.name, distance: l.distance, direction: l.direction });
    }
    for (const n of (signals.adjacent_landmarks || [])) {
        if (n) landmarkRefs.push({ name: n });
    }

    const seen = new Set();
    const rejected_generic = [];
    const dedup = landmarkRefs.filter(l => {
        if (isGenericLandmark(l.name)) {
            rejected_generic.push(l.name);
            return false;
        }
        const k = normLandmark(l.name);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    const resolved = [];
    const rejected_far = [];
    const landmarks_collapsed = [];
    // Phase A.5+ collapsed-landmark detection.
    //
    // Mapbox sometimes "resolves" a specific named landmark by returning the
    // surrounding urbanization centroid — e.g. it has no POI for "Guadalmina
    // Baja Golf Course" and falls back to the Guadalmina urbanization. The
    // resulting coord may equal or hug the listing's existing anchor, which
    // would otherwise pass the cross-check as if the landmark corroborated
    // the anchor. Two signals catch this:
    //   - distance to anchor < 50 m → a "specific" POI returning the same
    //     coord as the listing's city centroid is almost certainly Mapbox
    //     collapsing to the parent area.
    //   - place_name's first segment equals the listing's city/location.
    //     Even at >50 m, when Mapbox's first-segment IS just the listing's
    //     city, the resolution is at urbanization granularity, not POI.
    const cityNormForCollapse = (function () {
        const c = listing.city || '';
        return c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    })();
    function detectCollapse(r) {
        if (!r) return null;
        if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
            const dist = Math.round(haversineMeters(anchor.lat, anchor.lng, r.lat, r.lng));
            if (dist < 50) return { reason: 'within_50m_of_anchor', distance_m: dist, place_name: r.place_name };
        }
        if (r.place_name && cityNormForCollapse) {
            const firstSeg = r.place_name.split(',')[0].trim()
                .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
            if (firstSeg && firstSeg === cityNormForCollapse) {
                return { reason: 'place_name_matches_listing_city', place_name: r.place_name };
            }
        }
        return null;
    }

    for (const ref of dedup) {
        const r = await resolveLandmark(ref.name, listing.city, mapboxToken, anchor, cache);
        if (!r) {
            rejected_far.push(ref.name);
            continue;
        }
        const collapse = detectCollapse(r);
        if (collapse) {
            landmarks_collapsed.push({ name: ref.name, ...collapse });
            continue;
        }
        r.claimed_distance_m = parseDistanceMeters(ref.distance);
        r.claimed_direction = ref.direction || null;
        resolved.push(r);
    }
    trace.landmarks_resolved = resolved.map(r => ({
        name: r.name, lat: r.lat, lng: r.lng, place_name: r.place_name,
        claimed_distance_m: r.claimed_distance_m, claimed_direction: r.claimed_direction
    }));
    trace.landmarks_rejected_generic = rejected_generic;
    trace.landmarks_rejected_far = rejected_far;
    trace.landmarks_collapsed = landmarks_collapsed;

    // 3. Compute candidate from validated landmarks anchored to the verified
    // municipality coord.
    const candidate = computeCandidate(anchor, signals, resolved);
    if (candidate) {
        // The new computeCandidate may include a candidates_considered audit
        // log capturing anchor vs landmark-centroid disagreement. Fall back
        // to a single-element list when not present (no-landmarks path).
        trace.candidates_considered = candidate.candidates_considered ||
            [{ lat: candidate.lat, lng: candidate.lng, source: candidate.source, score: candidate.score, inputs: candidate.inputs }];
        if (typeof candidate.centroid_vs_anchor_m === 'number') {
            trace.centroid_vs_anchor_m = candidate.centroid_vs_anchor_m;
        }
    }

    // 4. Cadastre verification at candidate. If the candidate equals the
    // strike-1 anchor exactly, reuse the parcels we already fetched.
    let prefetched = null;
    if (candidate && muniResult.parcels && muniResult.parcels.length &&
        Math.abs(candidate.lat - anchor.lat) < 1e-9 &&
        Math.abs(candidate.lng - anchor.lng) < 1e-9) {
        prefetched = muniResult.parcels;
    }
    const cadastreResult = await cadastreVerify(candidate, listing, signals, prefetched, cache);
    trace.cadastre_check = cadastreResult;

    // 5. Tier assignment, with tier_floor cap from strike outcome.
    const decision = assignTier(
        candidate, cadastreResult, signals, resolved, listing,
        muniResult.tier_floor, muniResult.source
    );
    trace.final_confidence_score = decision.score;
    trace.final_decision_reason = decision.reason;

    // year_built provenance seed (for Option D writeback in Checkpoint 3).
    let year_built_seed = null;
    if (cadastreResult && cadastreResult.best_match && cadastreResult.best_match.year) {
        year_built_seed = {
            year: cadastreResult.best_match.year,
            refcat: cadastreResult.best_match.refcat,
            source: 'cadastre'
        };
    }

    return {
        lat: decision.lat,
        lng: decision.lng,
        locationConfidence: decision.tier,
        locationSource: decision.source,
        reasoning_trace: trace,
        year_built_seed,
        year_built_extracted: signals.year_built_extracted || null,
        year_built_extracted_confidence: signals.year_built_extracted_confidence || null,
        usage
    };
}

module.exports = {
    triangulateLocation,
    extractSignals,
    resolveLandmark,
    computeCandidate,
    parseDistanceMeters,
    haversineMeters,
    normLandmark,
    SYSTEM_PROMPT,
    USER_TEMPLATE,
    MALAGA_BBOX
};
