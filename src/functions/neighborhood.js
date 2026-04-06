/**
 * neighborhood.js — Neighborhood lifestyle scores (Azure Functions v4)
 *
 * Uses a SINGLE OpenStreetMap Overpass query to fetch all POIs
 * in one round trip, then counts categories locally.
 * This avoids rate limiting and multiple timeouts.
 *
 * GET /api/neighborhood?lat={lat}&lng={lng}&propertyId={id}
 */

const { app } = require('@azure/functions');
const fetch   = require('node-fetch');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json'
};

// ── Score label tiers ─────────────────────────────────────────────────────────

function label(score, tiers) {
  if (score === null) return null;
  for (const [min, text] of tiers) {
    if (score >= min) return text;
  }
  return tiers[tiers.length - 1][1];
}

const WALK_TIERS    = [[8,"Walker's Paradise"],[6,'Very Walkable'],   [4,'Walkable'],         [2,'Some Walkability'], [0,'Car-Dependent']];
const TRANSIT_TIERS = [[8,'Excellent Transit'],[6,'Good Transit'],    [4,'Some Transit'],     [2,'Minimal Transit'],  [0,'No Transit']];
const BIKE_TIERS    = [[8,"Biker's Paradise"], [6,'Very Bikeable'],   [4,'Bikeable'],         [2,'Some Bike Infra'],  [0,'Minimal Bike Infra']];
const NOISE_TIERS   = [[8,'Quiet Area'],       [6,'Mostly Quiet'],   [4,'Some Noise'],       [2,'Noisy'],            [0,'Very Noisy']];
const WELL_TIERS    = [[8,'Wellness Paradise'],[6,'Healthy Area'],   [4,'Some Wellness'],    [0,'Limited Wellness']];
const GREEN_TIERS   = [[8,'Tree-Filled'],      [6,'Good Green Space'],[4,'Some Green Space'], [0,'Limited Green Space']];

// ── Normalise helpers ─────────────────────────────────────────────────────────

function norm(count, max) {
  if (count === null || count === undefined) return null;
  return Math.round(Math.min(count, max) / max * 100) / 10;
}

function normInv(count, max) {
  if (count === null || count === undefined) return null;
  return Math.round((1 - Math.min(count, max) / max) * 100) / 10;
}

// ── Categorise a single Overpass element into our buckets ─────────────────────

function categorise(el) {
  const t = el.tags || {};
  const type = el.type; // node | way | relation
  const buckets = new Set();

  // WALK — shops and walkable amenities within 500m
  if (t.shop) buckets.add('walk');
  if (t.amenity && /^(restaurant|cafe|fast_food|bar|pub|supermarket|convenience|pharmacy|bank|post_office|bakery|butcher|marketplace)$/.test(t.amenity)) buckets.add('walk');

  // TRANSIT — bus stops and train stations
  if (t.highway === 'bus_stop') buckets.add('transit');
  if (t.amenity === 'bus_station') buckets.add('transit');
  if (t.railway && /^(station|tram_stop|halt|subway_entrance)$/.test(t.railway)) buckets.add('transit');

  // BIKE — cycling infrastructure
  if (type === 'way' && t.highway === 'cycleway') buckets.add('bike');
  if (type === 'way' && t.cycleway && /^(lane|track|opposite_lane|opposite_track)$/.test(t.cycleway)) buckets.add('bike');
  if (type === 'way' && t.bicycle && /^(designated|yes)$/.test(t.bicycle)) buckets.add('bike');

  // NOISE — major roads and railways (inverted score)
  if (type === 'way' && t.highway && /^(motorway|trunk|primary|secondary)$/.test(t.highway)) buckets.add('noise');
  if (type === 'way' && t.railway === 'rail') buckets.add('noise');

  // WELLNESS — health and fitness
  if (t.amenity && /^(pharmacy|hospital|clinic|doctors|dentist)$/.test(t.amenity)) buckets.add('wellness');
  if (t.leisure && /^(fitness_centre|sports_centre|swimming_pool|gym)$/.test(t.leisure)) buckets.add('wellness');

  // GREEN — parks and nature
  if (type === 'way' && t.leisure && /^(park|garden|nature_reserve|pitch|playground)$/.test(t.leisure)) buckets.add('green');
  if (type === 'way' && t.landuse && /^(grass|meadow|forest|recreation_ground|village_green)$/.test(t.landuse)) buckets.add('green');
  if (t.natural && /^(wood|scrub|grassland|beach)$/.test(t.natural)) buckets.add('green');

  return buckets;
}

// ── Azure Function handler ────────────────────────────────────────────────────

try {
app.http('neighborhood', {
  methods:   ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route:     'neighborhood',
  handler:   async (request, context) => {

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: CORS, body: '' };
    }

    const qs  = new URL(request.url).searchParams;
    const lat = parseFloat(qs.get('lat') || '');
    const lng = parseFloat(qs.get('lng') || '');
    const pid = qs.get('propertyId') || '?';

    if (isNaN(lat) || isNaN(lng)) {
      return { status: 400, headers: CORS,
               body: JSON.stringify({ error: 'lat and lng are required' }) };
    }

    context.log(`Neighborhood: ${pid} @ ${lat},${lng}`);

    // ── Single combined Overpass query ────────────────────────────────────────
    // Fetch all relevant POIs in ONE request, categorise locally.
    // Using out tags; (no geometry) keeps response size small.

    const query = `[out:json][timeout:55];
(
  node["shop"](around:500,${lat},${lng});
  node["amenity"~"restaurant|cafe|fast_food|bar|pub|supermarket|convenience|pharmacy|bank|post_office|bakery|butcher|marketplace"](around:500,${lat},${lng});
  node["highway"="bus_stop"](around:800,${lat},${lng});
  node["amenity"="bus_station"](around:800,${lat},${lng});
  node["railway"~"station|tram_stop|halt|subway_entrance"](around:1200,${lat},${lng});
  way["highway"="cycleway"](around:1000,${lat},${lng});
  way["cycleway"~"lane|track|opposite_lane|opposite_track"](around:1000,${lat},${lng});
  way["bicycle"~"designated|yes"]["highway"](around:1000,${lat},${lng});
  way["highway"~"motorway|trunk|primary|secondary"](around:300,${lat},${lng});
  way["railway"="rail"](around:300,${lat},${lng});
  node["amenity"~"pharmacy|hospital|clinic|doctors|dentist"](around:800,${lat},${lng});
  node["leisure"~"fitness_centre|sports_centre|swimming_pool|gym"](around:800,${lat},${lng});
  way["leisure"~"park|garden|nature_reserve|pitch|playground"](around:800,${lat},${lng});
  way["landuse"~"grass|meadow|forest|recreation_ground|village_green"](around:800,${lat},${lng});
  node["natural"~"wood|scrub|grassland|beach"](around:800,${lat},${lng});
  way["natural"~"wood|scrub|grassland|beach"](around:800,${lat},${lng});
);
out tags;`;

    const mirrors = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    let elements = null;
    for (const mirror of mirrors) {
      try {
        context.log(`Trying ${mirror}`);
        const res = await fetch(mirror, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    `data=${encodeURIComponent(query)}`,
          timeout: 55000
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        elements = data.elements || [];
        context.log(`Got ${elements.length} elements from ${mirror}`);
        break; // success — stop trying mirrors
      } catch (e) {
        context.log(`Mirror ${mirror} failed: ${e.message}`);
      }
    }

    if (elements === null) {
      // All mirrors failed — return nulls gracefully
      context.log('All Overpass mirrors failed');
      return {
        status: 200, headers: CORS,
        body: JSON.stringify({
          walkability: { score: null, label: null, icon: '🚶' },
          transit:     { score: null, label: null, icon: '🚌' },
          bike:        { score: null, label: null, icon: '🚲' },
          noise:       { score: null, label: null, icon: '🔇' },
          wellness:    { score: null, label: null, icon: '🌿' },
          green:       { score: null, label: null, icon: '🌳' },
          source: 'openstreetmap',
          error: 'Overpass unavailable',
          generatedAt: new Date().toISOString()
        })
      };
    }

    // ── Count elements per bucket ─────────────────────────────────────────────

    const counts = { walk: 0, transit: 0, bike: 0, noise: 0, wellness: 0, green: 0 };
    for (const el of elements) {
      const buckets = categorise(el);
      for (const b of buckets) counts[b]++;
    }
    context.log('Counts:', JSON.stringify(counts));

    // ── Normalise ─────────────────────────────────────────────────────────────

    const walkScore    = norm(counts.walk,    25);
    const transitScore = norm(counts.transit, 15);
    const bikeScore    = norm(counts.bike,    10);
    const noiseScore   = normInv(counts.noise, 4);
    const wellScore    = norm(counts.wellness, 8);
    const greenScore   = norm(counts.green,    6);

    return {
      status: 200, headers: CORS,
      body: JSON.stringify({
        walkability: { score: walkScore,    label: label(walkScore,    WALK_TIERS),    icon: '🚶', raw: counts.walk    },
        transit:     { score: transitScore, label: label(transitScore, TRANSIT_TIERS), icon: '🚌', raw: counts.transit },
        bike:        { score: bikeScore,    label: label(bikeScore,    BIKE_TIERS),    icon: '🚲', raw: counts.bike    },
        noise:       { score: noiseScore,   label: label(noiseScore,   NOISE_TIERS),   icon: '🔇', raw: counts.noise   },
        wellness:    { score: wellScore,    label: label(wellScore,    WELL_TIERS),    icon: '🌿', raw: counts.wellness},
        green:       { score: greenScore,   label: label(greenScore,   GREEN_TIERS),   icon: '🌳', raw: counts.green   },
        source: 'openstreetmap',
        totalElements: elements.length,
        generatedAt: new Date().toISOString()
      })
    };
  }
});
} catch (err) {
  console.error('Failed to register neighborhood function:', err);
}
