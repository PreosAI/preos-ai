/**
 * neighborhood.js — Neighborhood lifestyle scores (Azure Functions v4)
 *
 * Uses OpenStreetMap Overpass API exclusively — free, no key required,
 * global coverage, well-mapped for Spain and Costa del Sol.
 *
 * Runs 5 Overpass queries in parallel to count POIs around the property,
 * normalises each count to a 0–10 score, and returns 6 lifestyle scores:
 * walkability, transit, bike, noise, wellness, green.
 *
 * GET /api/neighborhood?lat={lat}&lng={lng}&propertyId={id}
 *
 * Response shape:
 * {
 *   walkability: { score: 7.2, label: 'Very Walkable',    icon: '🚶' },
 *   transit:     { score: 5.6, label: 'Good Transit',     icon: '🚌' },
 *   bike:        { score: 4.1, label: 'Bikeable',         icon: '🚲' },
 *   noise:       { score: 8.1, label: 'Quiet Area',       icon: '🔇' },
 *   wellness:    { score: 6.4, label: 'Healthy Area',     icon: '🌿' },
 *   green:       { score: 5.9, label: 'Some Green Space', icon: '🌳' },
 *   source: 'openstreetmap',
 *   generatedAt: '2026-04-06T...'
 * }
 */

const { app } = require('@azure/functions');
const fetch   = require('node-fetch');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json'
};

// ── Overpass query helper ─────────────────────────────────────────────────────

async function overpassCount(query) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(query)}`,
    timeout: 12000
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  // out count; returns a single element with tags.total
  if (data.elements && data.elements[0] && data.elements[0].tags) {
    return parseInt(data.elements[0].tags.total || 0);
  }
  // fallback: count elements array length
  return data.elements ? data.elements.length : 0;
}

// ── Score labels ──────────────────────────────────────────────────────────────

function label(score, tiers) {
  for (const [min, text] of tiers) {
    if (score >= min) return text;
  }
  return tiers[tiers.length - 1][1];
}

const WALK_TIERS    = [[8,'Walker\'s Paradise'],[6,'Very Walkable'],[4,'Walkable'],[2,'Some Walkability'],  [0,'Car-Dependent']];
const TRANSIT_TIERS = [[8,'Excellent Transit'], [6,'Good Transit'],  [4,'Some Transit'],[2,'Minimal Transit'],[0,'No Transit']];
const BIKE_TIERS    = [[8,'Biker\'s Paradise'], [6,'Very Bikeable'],  [4,'Bikeable'],   [2,'Some Bike Infra'],[0,'Minimal Bike Infra']];
const NOISE_TIERS   = [[8,'Quiet Area'],        [6,'Mostly Quiet'],  [4,'Some Noise'],  [2,'Noisy'],          [0,'Very Noisy']];
const WELL_TIERS    = [[8,'Wellness Paradise'], [6,'Healthy Area'],  [4,'Some Wellness'],[0,'Limited Wellness']];
const GREEN_TIERS   = [[8,'Tree-Filled'],       [6,'Good Green Space'],[4,'Some Green Space'],[0,'Limited Green Space']];

// ── Normalise helpers ─────────────────────────────────────────────────────────

// Clamp count to [0, max], map linearly to 0–10, round to 1dp
function norm(count, max) {
  if (count === null || count === undefined) return null;
  return Math.round(Math.min(count, max) / max * 100) / 10;
}

// Inverted: fewer noisy roads = higher score
function normInv(count, max) {
  if (count === null || count === undefined) return null;
  return Math.round((1 - Math.min(count, max) / max) * 100) / 10;
}

// ── Azure Function handler ────────────────────────────────────────────────────

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
      return {
        status: 400, headers: CORS,
        body: JSON.stringify({ error: 'lat and lng are required' })
      };
    }

    context.log(`Neighborhood: ${pid} @ ${lat},${lng}`);

    // ── Overpass queries ─────────────────────────────────────────────────────
    // All use "out count;" for efficiency — returns just the total count

    const queries = {
      walk: `[out:json][timeout:10];
(
  node["shop"](around:500,${lat},${lng});
  node["amenity"~"restaurant|cafe|fast_food|bar|pub|supermarket|convenience|pharmacy|bank|post_office"](around:500,${lat},${lng});
);
out count;`,

      transit: `[out:json][timeout:10];
(
  node["highway"="bus_stop"](around:800,${lat},${lng});
  node["amenity"="bus_station"](around:800,${lat},${lng});
  node["railway"~"station|tram_stop|halt|subway_entrance"](around:1200,${lat},${lng});
);
out count;`,

      bike: `[out:json][timeout:10];
(
  way["highway"="cycleway"](around:1000,${lat},${lng});
  way["cycleway"~"lane|track|opposite_lane|opposite_track"](around:1000,${lat},${lng});
  way["bicycle"~"designated|yes"](around:1000,${lat},${lng});
  way["route"="bicycle"](around:1000,${lat},${lng});
);
out count;`,

      noise: `[out:json][timeout:10];
(
  way["highway"~"motorway|trunk|primary|secondary"](around:300,${lat},${lng});
  way["railway"="rail"](around:300,${lat},${lng});
  node["aeroway"="aerodrome"](around:3000,${lat},${lng});
);
out count;`,

      wellness: `[out:json][timeout:10];
(
  node["amenity"~"pharmacy|hospital|clinic|doctors|dentist"](around:800,${lat},${lng});
  node["leisure"~"fitness_centre|sports_centre|swimming_pool|gym"](around:800,${lat},${lng});
  node["sport"](around:800,${lat},${lng});
);
out count;`,

      green: `[out:json][timeout:10];
(
  way["leisure"~"park|garden|nature_reserve|pitch|playground"](around:800,${lat},${lng});
  way["landuse"~"grass|meadow|forest|recreation_ground|village_green"](around:800,${lat},${lng});
  node["natural"~"wood|scrub|grassland|beach"](around:800,${lat},${lng});
  way["natural"~"wood|scrub|grassland|beach"](around:800,${lat},${lng});
);
out count;`
    };

    // Run all 5 queries in parallel
    const counts = {};
    await Promise.all(
      Object.entries(queries).map(async ([key, q]) => {
        try {
          counts[key] = await overpassCount(q);
          context.log(`  ${key}: ${counts[key]}`);
        } catch (e) {
          context.log(`  ${key} error: ${e.message}`);
          counts[key] = null;
        }
      })
    );

    // ── Normalise ─────────────────────────────────────────────────────────────
    // Thresholds calibrated for Costa del Sol urban areas:
    //   walk:    25 amenities within 500m = perfect 10
    //   transit: 15 stops within 800m    = perfect 10
    //   bike:    10 cycling ways         = perfect 10
    //   noise:   4+ noisy roads          = 0 (inverted)
    //   wellness: 8 wellness nodes       = perfect 10
    //   green:   6 green areas           = perfect 10

    const walkScore    = norm(counts.walk,    25);
    const transitScore = norm(counts.transit, 15);
    const bikeScore    = norm(counts.bike,    10);
    const noiseScore   = normInv(counts.noise, 4);
    const wellScore    = norm(counts.wellness, 8);
    const greenScore   = norm(counts.green,    6);

    return {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        walkability: { score: walkScore,    label: label(walkScore,    WALK_TIERS),    icon: '🚶' },
        transit:     { score: transitScore, label: label(transitScore, TRANSIT_TIERS), icon: '🚌' },
        bike:        { score: bikeScore,    label: label(bikeScore,    BIKE_TIERS),    icon: '🚲' },
        noise:       { score: noiseScore,   label: label(noiseScore,   NOISE_TIERS),   icon: '🔇' },
        wellness:    { score: wellScore,    label: label(wellScore,    WELL_TIERS),    icon: '🌿' },
        green:       { score: greenScore,   label: label(greenScore,   GREEN_TIERS),   icon: '🌳' },
        source:      'openstreetmap',
        generatedAt: new Date().toISOString()
      })
    };
  }
});
