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
    walkability: norm(c.walk,     25),
    transit:     norm(c.transit,  15),
    bike:        norm(c.bike,     10),
    noise:       normInv(c.noise,  4),
    wellness:    norm(c.wellness,  8),
    green:       norm(c.green,     6),
    cachedAt:    new Date().toISOString()
  };
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`\nPreos neighborhood enrichment — ${PROPERTIES.length} properties\n`);

  for (const prop of PROPERTIES) {
    console.log(`\n[${prop.id}] ${prop.location} (${prop.lat}, ${prop.lng})`);

    // Check if already cached
    const doc = await db.collection('enrichment').doc(prop.id).get();
    const existing = doc.exists && doc.data().neighborhood;
    if (existing && existing.cachedAt) {
      const ageDays = (Date.now() - new Date(existing.cachedAt).getTime()) / 86400000;
      if (ageDays < 30) {
        console.log(`  ⏭  already cached (${ageDays.toFixed(1)} days old) — skipping`);
        continue;
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
