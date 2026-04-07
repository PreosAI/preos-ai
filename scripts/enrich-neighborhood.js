/**
 * enrich-neighborhood.js
 *
 * One-time batch script — fetches OpenStreetMap Overpass
 * scores for all properties and writes to Firestore.
 *
 * Usage:
 *   node scripts/enrich-neighborhood.js
 *
 * Requirements:
 *   npm install node-fetch@2 firebase-admin
 *   Set GOOGLE_APPLICATION_CREDENTIALS env var to your
 *   Firebase service account JSON path, OR place the
 *   service account JSON at scripts/serviceAccount.json
 */

const fetch   = require('node-fetch');
const admin   = require('firebase-admin');
const path    = require('path');

// ── Firebase init ─────────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = require('./serviceAccount.json');
} catch(e) {
  console.error('Place your Firebase service account JSON at scripts/serviceAccount.json');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// ── All sandbox properties ────────────────────────────────
const PROPERTIES = [
  { id: 'R3479851', lat: 36.6602, lng: -4.7601, location: 'Coín' },
  { id: 'R3479779', lat: 36.6218, lng: -4.4998, location: 'Torremolinos' },
  { id: 'R3479773', lat: 36.5984, lng: -4.5159, location: 'Benalmádena' },
  { id: 'R3479776', lat: 36.6237, lng: -4.4997, location: 'Torremolinos' },
  { id: 'R3479815', lat: 36.5971, lng: -4.5201, location: 'Benalmádena' },
  { id: 'R3479809', lat: 36.5963, lng: -4.5178, location: 'Benalmádena' },
  { id: 'R3479782', lat: 36.6244, lng: -4.5012, location: 'Torremolinos' },
  { id: 'R3479899', lat: 36.5407, lng: -4.6225, location: 'Fuengirola' },
  { id: 'R3479887', lat: 36.5958, lng: -4.6375, location: 'Mijas' },
  { id: 'R3479884', lat: 36.5991, lng: -4.5143, location: 'Benalmádena' }
];

// ── Overpass mirrors ──────────────────────────────────────
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// ── Score normalisers ─────────────────────────────────────
function norm(v, max)  { return Math.round(Math.min(v, max) / max * 100) / 10; }
function normInv(v, max){ return Math.round((1 - Math.min(v, max) / max) * 100) / 10; }

// ── Sleep helper ──────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch scores for one property ────────────────────────
async function fetchScores(prop) {
  const { lat, lng } = prop;

  const query = `[out:json][timeout:40];
(
  node["shop"](around:500,${lat},${lng});
  node["amenity"~"restaurant|cafe|fast_food|bar|pub|supermarket|convenience|pharmacy|bank|post_office|bakery"](around:500,${lat},${lng});
  node["highway"="bus_stop"](around:800,${lat},${lng});
  node["amenity"="bus_station"](around:800,${lat},${lng});
  node["railway"~"station|tram_stop|halt|subway_entrance"](around:1200,${lat},${lng});
  way["highway"="cycleway"](around:1000,${lat},${lng});
  way["cycleway"~"lane|track"](around:1000,${lat},${lng});
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

  let elements = null;

  for (const mirror of MIRRORS) {
    try {
      console.log(`  → trying ${mirror}`);
      const res = await fetch(mirror, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'data=' + encodeURIComponent(query),
        timeout: 45000
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      elements = data.elements || [];
      console.log(`  ✅ got ${elements.length} elements`);
      break;
    } catch (e) {
      console.warn(`  ⚠️  mirror failed: ${e.message}`);
      await sleep(3000);
    }
  }

  if (!elements) return null;

  // Count categories
  const c = { walk:0, transit:0, bike:0, noise:0, wellness:0, green:0 };
  for (const el of elements) {
    const t  = el.tags || {};
    const ty = el.type;
    if (t.shop) c.walk++;
    if (t.amenity && /^(restaurant|cafe|fast_food|bar|pub|supermarket|convenience|pharmacy|bank|post_office|bakery)$/.test(t.amenity)) c.walk++;
    if (t.highway === 'bus_stop' || t.amenity === 'bus_station') c.transit++;
    if (t.railway && /^(station|tram_stop|halt|subway_entrance)$/.test(t.railway)) c.transit++;
    if (ty === 'way' && (t.highway === 'cycleway' || (t.cycleway && /^(lane|track)$/.test(t.cycleway)))) c.bike++;
    if (ty === 'way' && t.bicycle && /^(designated|yes)$/.test(t.bicycle) && t.highway) c.bike++;
    if (ty === 'way' && t.highway && /^(motorway|trunk|primary|secondary)$/.test(t.highway)) c.noise++;
    if (ty === 'way' && t.railway === 'rail') c.noise++;
    if (t.amenity && /^(pharmacy|hospital|clinic|doctors|dentist)$/.test(t.amenity)) c.wellness++;
    if (t.leisure && /^(fitness_centre|sports_centre|swimming_pool|gym)$/.test(t.leisure)) c.wellness++;
    if (ty === 'way' && t.leisure && /^(park|garden|nature_reserve|pitch|playground)$/.test(t.leisure)) c.green++;
    if (ty === 'way' && t.landuse && /^(grass|meadow|forest|recreation_ground|village_green)$/.test(t.landuse)) c.green++;
    if (t.natural && /^(wood|scrub|grassland|beach)$/.test(t.natural)) c.green++;
  }

  console.log(`  counts: walk=${c.walk} transit=${c.transit} bike=${c.bike} noise=${c.noise} wellness=${c.wellness} green=${c.green}`);

  return {
    walkability: norm(c.walk,     250),
    transit:     norm(c.transit,   35),
    bike:        norm(c.bike,      25),
    noise:       normInv(c.noise,  30),
    wellness:    norm(c.wellness, 260),
    green:       norm(c.green,    125),
    cachedAt:    new Date().toISOString()
  };
}

// ── Haversine distance in metres ─────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI/180) *
            Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// ── Fetch nearby POIs with names for tab panels ───────────
async function fetchPOIs(prop) {
  const { lat, lng } = prop;

  const query = `[out:json][timeout:30];
(
  node["amenity"~"school|kindergarten|college|university"](around:2000,${lat},${lng});
  node["amenity"~"restaurant|cafe|fast_food|bar|pub"](around:600,${lat},${lng});
  node["shop"~"supermarket|convenience|bakery|butcher|greengrocer"](around:600,${lat},${lng});
  node["amenity"~"pharmacy|hospital|clinic|doctors|dentist|bank|post_office"](around:600,${lat},${lng});
  node["leisure"~"park|playground|sports_centre|swimming_pool"](around:800,${lat},${lng});
  node["highway"="bus_stop"](around:800,${lat},${lng});
  node["railway"~"station|tram_stop|halt"](around:1500,${lat},${lng});
);
out body qt;`;

  for (const mirror of [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ]) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        timeout: 35000
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const elements = data.elements || [];

      // Categorise and calculate distances
      const schools   = [];
      const places    = [];
      const transport = [];

      for (const el of elements) {
        if (!el.lat || !el.lon || !el.tags) continue;
        const t    = el.tags;
        const name = t.name || t['name:es'] || t['name:en'] || null;
        if (!name) continue; // skip unnamed POIs

        const dist = haversine(lat, lng, el.lat, el.lon);

        // Schools
        if (t.amenity === 'school')       schools.push({ name, type: 'Colegio',      dist });
        if (t.amenity === 'kindergarten') schools.push({ name, type: 'Guardería',    dist });
        if (t.amenity === 'college')      schools.push({ name, type: 'Instituto',    dist });
        if (t.amenity === 'university')   schools.push({ name, type: 'Universidad',  dist });

        // Transport
        if (t.highway === 'bus_stop')              transport.push({ name, type: 'Autobús',  dist });
        if (t.railway === 'station')               transport.push({ name, type: 'Tren',     dist });
        if (t.railway === 'tram_stop')             transport.push({ name, type: 'Tranvía',  dist });
        if (t.railway === 'halt')                  transport.push({ name, type: 'Tren',     dist });

        // Places (restaurants, shops, services, leisure)
        if (t.amenity === 'restaurant')   places.push({ name, type: 'Restaurante', dist });
        if (t.amenity === 'cafe')         places.push({ name, type: 'Café',        dist });
        if (t.amenity === 'fast_food')    places.push({ name, type: 'Comida rápida', dist });
        if (t.amenity === 'bar' || t.amenity === 'pub') places.push({ name, type: 'Bar', dist });
        if (t.shop    === 'supermarket')  places.push({ name, type: 'Supermercado', dist });
        if (t.shop    === 'convenience')  places.push({ name, type: 'Tienda',       dist });
        if (t.shop    === 'bakery')       places.push({ name, type: 'Panadería',    dist });
        if (t.shop    === 'butcher')      places.push({ name, type: 'Carnicería',   dist });
        if (t.shop    === 'greengrocer')  places.push({ name, type: 'Frutería',     dist });
        if (t.amenity === 'pharmacy')     places.push({ name, type: 'Farmacia',     dist });
        if (t.amenity === 'bank')         places.push({ name, type: 'Banco',        dist });
        if (t.amenity === 'hospital' ||
            t.amenity === 'clinic' ||
            t.amenity === 'doctors' ||
            t.amenity === 'dentist')      places.push({ name, type: 'Salud',        dist });
        if (t.leisure === 'park')         places.push({ name, type: 'Parque',       dist });
        if (t.leisure === 'playground')   places.push({ name, type: 'Parque infantil', dist });
        if (t.leisure === 'sports_centre' ||
            t.leisure === 'swimming_pool') places.push({ name, type: 'Deporte',     dist });
      }

      // Sort by distance, deduplicate by name, take top N
      function topN(arr, n) {
        const seen = new Set();
        return arr
          .sort((a, b) => a.dist - b.dist)
          .filter(item => { if (seen.has(item.name)) return false; seen.add(item.name); return true; })
          .slice(0, n);
      }

      return {
        schools:   topN(schools,   6),
        places:    topN(places,    8),
        transport: topN(transport, 6)
      };

    } catch(e) {
      console.warn(`  POI mirror failed: ${e.message}`);
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`\nPreos neighborhood enrichment — ${PROPERTIES.length} properties\n`);

  const force = process.argv.includes('--force');
  console.log(force ? '⚡ Force mode — re-enriching all properties' : '📦 Normal mode — skipping fresh cache');

  for (const prop of PROPERTIES) {
    console.log(`\n[${prop.id}] ${prop.location} (${prop.lat}, ${prop.lng})`);

    // Skip if already cached and not forcing
    const doc = await db.collection('enrichment').doc(prop.id).get();
    if (doc.exists && doc.data().neighborhood) {
      const existing = doc.data().neighborhood;
      if (existing.cachedAt) {
        const ageDays = (Date.now() - new Date(existing.cachedAt).getTime()) / 86400000;
        if (!force && ageDays < 30) {
          console.log(`  ⏭  already cached (${ageDays.toFixed(1)} days old) — skipping`);
          continue;
        }
      }
    }

    // Fetch scores
    const scores = await fetchScores(prop);
    if (!scores) {
      console.log(`  ❌ all mirrors failed — skipping`);
      await sleep(10000); // longer wait after failure
      continue;
    }

    // Write to Firestore
    await db.collection('enrichment').doc(prop.id)
      .set({ neighborhood: scores }, { merge: true });
    console.log(`  💾 saved to Firestore: walk=${scores.walkability} transit=${scores.transit} bike=${scores.bike} noise=${scores.noise} wellness=${scores.wellness} green=${scores.green}`);

    // Fetch and store POI names for tab panels
    console.log('  🏪 fetching nearby POIs...');
    await sleep(3000); // polite delay after score query
    const pois = await fetchPOIs(prop);
    if (pois) {
      const totals = `schools:${pois.schools.length} places:${pois.places.length} transport:${pois.transport.length}`;
      console.log(`  📍 POIs found — ${totals}`);
      await db.collection('enrichment').doc(prop.id)
        .set({ neighborhood: { pois } }, { merge: true });
      console.log('  💾 POIs saved to Firestore');
    } else {
      console.log('  ⚠️  POI fetch failed');
    }

    // Polite delay between requests
    console.log('  ⏳ waiting 6s before next property...');
    await sleep(6000);
  }

  console.log('\n✅ Done! All properties enriched.\n');
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
