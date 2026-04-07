/**
 * enrich-catastro.js
 *
 * Batch script — looks up the official Spanish Catastro
 * cadastral reference (refcat) for each property by GPS
 * coordinates and writes results to Firestore.
 *
 * Data stored per property in enrichment/{id}.catastro:
 *   refcat       — full cadastral reference e.g. "5842210UF6554S"
 *   pc1          — first part of refcat
 *   pc2          — second part of refcat
 *   address      — official registered address from Catastro
 *   url          — direct link to Sede Electrónica del Catastro
 *   cachedAt     — ISO timestamp
 *
 * Usage:
 *   node scripts/enrich-catastro.js
 *   node scripts/enrich-catastro.js --force   (re-fetch all)
 *
 * Requirements (run from scripts/ folder):
 *   npm install node-fetch@2 firebase-admin
 *   scripts/serviceAccount.json must exist
 */

const fetch = require('node-fetch');
const admin = require('firebase-admin');

// ── Firebase init ─────────────────────────────────────────
let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing scripts/serviceAccount.json'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// ── Properties ────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractXmlValue(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
  const m  = xml.match(re);
  return m ? m[1].trim() : null;
}

// ── Catastro lookup by GPS coords ─────────────────────────
async function fetchCatastro(prop) {
  const url = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR` +
    `?SRS=EPSG:4326&Coordenada_X=${prop.lng}&Coordenada_Y=${prop.lat}`;

  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  // Check for error code
  const errCode = extractXmlValue(xml, 'cod');
  if (errCode === '16') {
    // No parcel at exact coordinates — try small offsets
    return null;
  }

  const pc1 = extractXmlValue(xml, 'pc1');
  const pc2 = extractXmlValue(xml, 'pc2');
  if (!pc1 || !pc2) return null;

  const refcat  = pc1 + pc2;
  const address = extractXmlValue(xml, 'ldt');

  return {
    refcat,
    pc1,
    pc2,
    address:    address || null,
    url:        `https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCListaBienes.aspx?rc1=${pc1}&rc2=${pc2}`,
    cachedAt:   new Date().toISOString()
  };
}

// ── Try with coordinate offsets if exact hit fails ────────
async function fetchWithOffsets(prop) {
  // Try exact coordinates first
  let result = await fetchCatastro(prop);
  if (result) return result;

  console.log('  ↪ exact coords missed parcel, trying offsets...');

  // Try small offsets (±0.0002 degrees ≈ ±20m)
  const offsets = [
    [0.0002,  0],     // E
    [-0.0002, 0],     // W
    [0,       0.0002],// N
    [0,      -0.0002],// S
    [0.0002,  0.0002],// NE
    [-0.0002,-0.0002] // SW
  ];

  for (const [dLng, dLat] of offsets) {
    await sleep(500);
    const shifted = { ...prop, lat: prop.lat + dLat, lng: prop.lng + dLng };
    result = await fetchCatastro(shifted);
    if (result) {
      console.log(`  ✅ found with offset [${dLng}, ${dLat}]`);
      return result;
    }
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  const force = process.argv.includes('--force');
  console.log(`\nPreos Catastro enrichment — ${PROPERTIES.length} properties`);
  console.log(force ? '⚡ Force mode\n' : '📦 Normal mode (skipping fresh cache)\n');

  let found = 0, skipped = 0, failed = 0;

  for (const prop of PROPERTIES) {
    console.log(`\n[${prop.id}] ${prop.location} (${prop.lat}, ${prop.lng})`);

    // Check existing cache
    const doc = await db.collection('enrichment').doc(prop.id).get();
    if (doc.exists && doc.data().catastro && doc.data().catastro.cachedAt) {
      const ageDays = (Date.now() - new Date(doc.data().catastro.cachedAt).getTime()) / 86400000;
      if (!force && ageDays < 90) {
        console.log(`  ⏭  already cached (${ageDays.toFixed(1)} days old) — skipping`);
        skipped++;
        continue;
      }
    }

    // Fetch from Catastro
    try {
      const catastro = await fetchWithOffsets(prop);

      if (!catastro) {
        console.log(`  ❌ no cadastral parcel found at or near these coordinates`);
        failed++;
      } else {
        await db.collection('enrichment').doc(prop.id)
          .set({ catastro }, { merge: true });
        console.log(`  💾 refcat: ${catastro.refcat}`);
        console.log(`  📍 address: ${catastro.address}`);
        console.log(`  🔗 ${catastro.url}`);
        found++;
      }
    } catch (e) {
      console.error(`  ❌ error: ${e.message}`);
      failed++;
    }

    // Polite delay between requests
    console.log('  ⏳ waiting 3s...');
    await sleep(3000);
  }

  console.log(`\n✅ Done — found: ${found}, skipped: ${skipped}, failed: ${failed}\n`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
