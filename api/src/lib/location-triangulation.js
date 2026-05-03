// Location triangulation pipeline (Phase A, Checkpoint 2).
//
// Pipeline:
//   1. LLM signal extraction (Claude Haiku 4.5) over the listing description
//      and metadata. Returns landmarks, urbanization name, building name,
//      directional cues, and (Option D) the year-built signal.
//   2. Resolve named landmarks to coordinates via Mapbox geocoding, biased
//      to the property's city and rejected if outside the Málaga bbox.
//   3. Compute a candidate coordinate from the resolved landmarks. With ≥2
//      landmarks we use the centroid; with 1 we use the landmark coord; with
//      0 we fall back to the listing's existing Mapbox lat/lng.
//   4. Cadastre cross-validation: lookupByCoords on the candidate, then
//      cross-check the returned address against LLM-extracted urbanization /
//      building / street fragments. Reward if the address contains those
//      tokens; penalise if it points to a clearly different urbanization.
//   5. Cadastre metadata match: matchParcelToListing → exact tier when
//      m² + use-type (and optionally year) score ≥ 50.
//   6. Assign final confidence tier per the rubric.
//
// Apartment buildings: we explicitly do NOT drill into <lcons> for unit-level
// m²/year today. Multi-unit listings whose 14-char parcel exposes only
// building-aggregate data will land in 'high' or 'medium' rather than 'exact'.
// Tracked as a Phase B improvement.
//
// OSM polygon constraint from the spec is also deferred. Without polygons we
// can't reject a candidate that's "outside the urbanization but in the same
// city"; that's accepted as a Checkpoint 2 simplification.

const { lookupByCoords, matchParcelToListing } = require('./cadastre');
const { callMessagesText, stripJsonFence } = require('./anthropic');

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

// Defence-in-depth: if the LLM still emits a generic term despite the prompt,
// reject it before sending to Mapbox. These were the actual failure cases
// observed in the first 50-property run.
const GENERIC_LANDMARK_TOKENS = new Set([
    'beach', 'beaches', 'sandy beaches', 'the beach', 'sea',
    'shops', 'restaurants', 'shopping', 'shopping centre',
    'golf', 'golf course', 'golf courses', 'tennis', 'tennis court', 'tennis courts',
    'park', 'parks', 'national park', 'parque nacional', 'parque natural',
    'parque nacional protegido', 'parque protegido',
    'mountain', 'mountains', 'forest', 'forests',
    'school', 'schools', 'supermarket', 'supermarkets',
    'pharmacy', 'church', 'churches', 'hospital', 'hospitals',
    'town centre', 'city centre', 'town center', 'city center',
    'beach club', 'restaurant', 'restaurants and bars',
    // Spanish equivalents
    'playa', 'playas', 'mar', 'tiendas', 'restaurantes',
    'parque', 'iglesia', 'colegio', 'farmacia', 'supermercado',
    'montana', 'montanas', 'bosque', 'campo de golf',
    'pueblo', 'centro'
]);

function isGenericLandmark(name) {
    if (!name) return true;
    const n = normLandmark(name);
    if (n.length < 4) return true;
    if (GENERIC_LANDMARK_TOKENS.has(n)) return true;
    if (/^(close to|near|next to)\b/.test(n)) return true;
    // Phrases like "sandy beach", "private beach", "beautiful beach" etc.
    for (const tok of GENERIC_LANDMARK_TOKENS) {
        if (n.endsWith(' ' + tok)) return true;
    }
    return false;
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

async function resolveLandmark(name, biasCity, mapboxToken, anchor) {
    if (!name) return null;
    const key = normLandmark(name);
    // Cache key includes anchor bucket so a landmark queried from two
    // different cities can still hit the cache when both anchors agree.
    if (_landmarkCache.has(key)) {
        const cached = _landmarkCache.get(key);
        if (cached === null) return null;
        if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
            const dist = haversineMeters(anchor.lat, anchor.lng, cached.lat, cached.lng);
            if (dist > ANCHOR_MAX_DIST_M) return null;
        }
        return cached;
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
        return null;
    }
    if (!res.ok) {
        _landmarkCache.set(key, null);
        return null;
    }
    const data = await res.json();
    if (!data.features || data.features.length === 0) {
        _landmarkCache.set(key, null);
        return null;
    }
    const f = data.features[0];
    const [lng, lat] = f.center || [];
    if (!inBbox(lat, lng)) {
        _landmarkCache.set(key, null);
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

    // Anchor distance gate.
    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
        const dist = haversineMeters(anchor.lat, anchor.lng, lat, lng);
        if (dist > ANCHOR_MAX_DIST_M) return null;
    }
    return out;
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

function computeCandidate(listing, signals, resolved) {
    const valid = (resolved || []).filter(r => r && Number.isFinite(r.lat) && Number.isFinite(r.lng));
    const hasExistingCoord = Number.isFinite(listing.lat) && Number.isFinite(listing.lng) && inBbox(listing.lat, listing.lng);

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
        // Single-landmark triangulation is not strong enough on its own —
        // blend it with the existing coord if we have one, otherwise use it
        // alone with reduced confidence.
        if (hasExistingCoord) {
            const dist = haversineMeters(listing.lat, listing.lng, valid[0].lat, valid[0].lng);
            // If the landmark is very close to the existing coord, we can use
            // either; prefer the landmark coord since it's more specific.
            // Otherwise keep the existing coord — single-landmark moves are
            // not trustworthy enough to override Mapbox.
            if (dist < 1000) {
                return {
                    lat: valid[0].lat, lng: valid[0].lng,
                    source: 'single_landmark',
                    score: 75,
                    inputs: [valid[0].name]
                };
            }
            return {
                lat: listing.lat, lng: listing.lng,
                source: 'mapbox_preserved_with_landmark',
                score: 60,
                inputs: ['existing-mapbox', valid[0].name + ' (too-far-to-trust)']
            };
        }
        return {
            lat: valid[0].lat, lng: valid[0].lng,
            source: 'single_landmark',
            score: 60,
            inputs: [valid[0].name]
        };
    }
    // No usable landmarks — keep the existing coord rather than relocating.
    if (hasExistingCoord) {
        return {
            lat: listing.lat, lng: listing.lng,
            source: 'mapbox_preserved',
            score: 40,
            inputs: ['existing-mapbox']
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

async function cadastreVerify(candidate, listing, signals) {
    if (!candidate) return null;
    let parcels = [];
    try {
        parcels = await lookupByCoords(candidate.lat, candidate.lng);
    } catch (e) {
        return { error: 'cadastre lookup failed: ' + e.message };
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
    const match = await matchParcelToListing(parcels, listingMeta, { maxParcels: 3 });

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

function assignTier(candidate, cadastreResult, signals, resolved, listing) {
    if (!candidate) {
        return {
            lat: null, lng: null,
            tier: 'rejected', source: 'rejected',
            score: 0,
            reason: 'No candidate coord — no landmarks resolved and no usable Mapbox fallback.'
        };
    }

    let score = candidate.score || 0;
    const reasons = ['candidate=' + candidate.source + ' base=' + score];

    if (cadastreResult && !cadastreResult.error) {
        // Address-token cross-check: ±15.
        if (cadastreResult.address_check && cadastreResult.address_check.result === 'match') {
            score += 15;
            reasons.push('cadastre-address-tokens-match +15');
        } else if (cadastreResult.address_check && cadastreResult.address_check.result === 'no-match') {
            score -= 20;
            reasons.push('cadastre-address-tokens-mismatch -20');
        }

        // Cadastre metadata match → exact tier when score ≥ 50.
        if (cadastreResult.best_match && (cadastreResult.best_match.score || 0) >= 50) {
            return {
                lat: candidate.lat, lng: candidate.lng,
                tier: 'exact',
                source: 'cadastre_verified',
                score: Math.min(100, score + 25),
                reason: reasons.concat([
                    'cadastre metadata match score=' + cadastreResult.best_match.score,
                    'refcat=' + cadastreResult.best_match.refcat
                ]).join(' · ')
            };
        }
    }

    // Tier from final confidence score.
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
    const { mapboxToken } = opts || {};
    if (!mapboxToken) throw new Error('triangulateLocation: mapboxToken is required');

    const trace = {
        signals_extracted: null,
        landmarks_resolved: [],
        candidates_considered: [],
        cadastre_check: null,
        final_confidence_score: 0,
        final_decision_reason: ''
    };

    // 1. LLM signal extraction.
    const { signals, usage } = await extractSignals(listing);
    trace.signals_extracted = signals;

    // 2. Resolve landmarks (de-duped by normalized name; generic filtered).
    const anchor = (Number.isFinite(listing.lat) && Number.isFinite(listing.lng))
        ? { lat: listing.lat, lng: listing.lng }
        : null;

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
    for (const ref of dedup) {
        const r = await resolveLandmark(ref.name, listing.city, mapboxToken, anchor);
        if (r) {
            r.claimed_distance_m = parseDistanceMeters(ref.distance);
            r.claimed_direction = ref.direction || null;
            resolved.push(r);
        } else {
            rejected_far.push(ref.name);
        }
    }
    trace.landmarks_resolved = resolved.map(r => ({
        name: r.name, lat: r.lat, lng: r.lng, place_name: r.place_name,
        claimed_distance_m: r.claimed_distance_m, claimed_direction: r.claimed_direction
    }));
    trace.landmarks_rejected_generic = rejected_generic;
    trace.landmarks_rejected_far = rejected_far;

    // 3. Compute candidate.
    const candidate = computeCandidate(listing, signals, resolved);
    if (candidate) {
        trace.candidates_considered = [{ ...candidate }];
    }

    // 4. Cadastre verification.
    const cadastreResult = await cadastreVerify(candidate, listing, signals);
    trace.cadastre_check = cadastreResult;

    // 5. Tier assignment.
    const decision = assignTier(candidate, cadastreResult, signals, resolved, listing);
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
