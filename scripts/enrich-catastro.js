/**
 * enrich-catastro.js
 *
 * Batch script — looks up Catastro refcat by GPS coordinates,
 * then compares against the refcat already in the Resales
 * listing data to produce a confidence score and best guess.
 *
 * Confidence algorithm:
 *   VERIFIED   — refcats match exactly
 *   HIGH       — PC1 matches (same building parcel)
 *   MEDIUM     — address fuzzy match but refcats differ
 *   LOW        — refcats differ, addresses don't match
 *   UNVERIFIED — Resales refcat not found in Catastro
 *   GPS_ONLY   — no Resales refcat to compare against
 *
 * Usage:
 *   node scripts/enrich-catastro.js
 *   node scripts/enrich-catastro.js --force
 */

const fetch = require('node-fetch');
const admin = require('firebase-admin');

let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing scripts/serviceAccount.json'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// ── Properties with their Resales refcats ─────────────────
// resales_refcat: from properties.json / Resales listing data
// If a property has no refcat in Resales data, leave null
const PROPERTIES = [
  { id:'R3479851', lat:36.6602, lng:-4.7601, location:'Coín',         resales_refcat: null },
  { id:'R3479779', lat:36.6218, lng:-4.4998, location:'Torremolinos', resales_refcat: null },
  { id:'R3479773', lat:36.5984, lng:-4.5159, location:'Benalmádena',  resales_refcat: '9872023VK4897S' },
  { id:'R3479776', lat:36.6237, lng:-4.4997, location:'Torremolinos', resales_refcat: null },
  { id:'R3479815', lat:36.5971, lng:-4.5201, location:'Benalmádena',  resales_refcat: null },
  { id:'R3479809', lat:36.5963, lng:-4.5178, location:'Benalmádena',  resales_refcat: null },
  { id:'R3479782', lat:36.6244, lng:-4.5012, location:'Torremolinos', resales_refcat: null },
  { id:'R3479899', lat:36.5407, lng:-4.6225, location:'Fuengirola',   resales_refcat: null },
  { id:'R3479887', lat:36.5958, lng:-4.6375, location:'Mijas',        resales_refcat: null },
  { id:'R3479884', lat:36.5991, lng:-4.5143, location:'Benalmádena',  resales_refcat: null }
];

// ── Helpers ───────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractXmlValue(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
  const m  = xml.match(re);
  return m ? m[1].trim() : null;
}

// Normalise address for fuzzy comparison
// Strips accents, punctuation, extra spaces, uppercases
function normaliseAddress(addr) {
  if (!addr) return '';
  return addr
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract meaningful tokens from an address for comparison
function addressTokens(addr) {
  const norm = normaliseAddress(addr);
  // Remove common words that don't help disambiguation
  const stopWords = ['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y',
    'AV', 'AVD', 'AVENIDA', 'CL', 'CALLE', 'PZ', 'PLAZA',
    'MALAGA', 'SPAIN', 'ESPANA', 'COSTA', 'DEL', 'SOL'];
  return norm.split(' ').filter(t => t.length > 1 && !stopWords.includes(t));
}

// How many tokens overlap between two addresses (0-1 score)
function addressSimilarity(addr1, addr2) {
  const t1 = new Set(addressTokens(addr1));
  const t2 = new Set(addressTokens(addr2));
  if (!t1.size || !t2.size) return 0;
  let overlap = 0;
  for (const t of t1) { if (t2.has(t)) overlap++; }
  return overlap / Math.max(t1.size, t2.size);
}

// ── Confidence algorithm ──────────────────────────────────
function computeConfidence(gpsRefcat, resalesRefcat, gpsAddress, resalesAddress) {
  // Case 1: No Resales refcat to compare
  if (!resalesRefcat) {
    return {
      status:        'gps_only',
      confidence:    'gps_only',
      best_refcat:   gpsRefcat,
      flag_review:   false,
      note:          'No Resales refcat available — using GPS lookup'
    };
  }

  // Case 2: No GPS refcat found
  if (!gpsRefcat) {
    return {
      status:        'resales_only',
      confidence:    'unverified',
      best_refcat:   resalesRefcat,
      flag_review:   true,
      note:          'GPS lookup found no parcel — using Resales refcat unverified'
    };
  }

  const pc1_gps     = gpsRefcat.substring(0, 7);
  const pc1_resales = resalesRefcat.substring(0, 7);
  const addrSim     = addressSimilarity(gpsAddress, resalesAddress);

  // Case 3: Exact match
  if (gpsRefcat === resalesRefcat) {
    return {
      status:      'exact_match',
      confidence:  'verified',
      best_refcat: gpsRefcat,
      flag_review: false,
      note:        'Exact match between GPS lookup and Resales refcat ✅'
    };
  }

  // Case 4: PC1 matches (same building parcel, different unit or encoding)
  if (pc1_gps === pc1_resales) {
    return {
      status:      'parcel_match',
      confidence:  'high',
      best_refcat: resalesRefcat, // agent knows the exact unit
      flag_review: false,
      note:        `Same parcel (PC1: ${pc1_gps}), unit codes differ — using Resales refcat`
    };
  }

  // Case 5: Addresses are similar (GPS landed on adjacent parcel)
  if (addrSim >= 0.5) {
    return {
      status:      'address_match',
      confidence:  'medium',
      best_refcat: resalesRefcat, // trust agent data when address matches
      flag_review: false,
      note:        `Refcats differ but addresses match (${Math.round(addrSim*100)}% similar) — using Resales refcat`
    };
  }

  // Case 6: Everything differs — needs review
  return {
    status:      'mismatch',
    confidence:  'low',
    best_refcat: gpsRefcat, // GPS is more objective than agent data
    flag_review: true,
    note:        `Refcat and address both differ — GPS: ${gpsRefcat}, Resales: ${resalesRefcat}, addr sim: ${Math.round(addrSim*100)}%`
  };
}

// ── Catastro GPS lookup ───────────────────────────────────
async function lookupByCoords(prop) {
  const url = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/` +
    `OVCCoordenadas.asmx/Consulta_RCCOOR` +
    `?SRS=EPSG:4326&Coordenada_X=${prop.lng}&Coordenada_Y=${prop.lat}`;

  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  const errCode = extractXmlValue(xml, 'cod');
  if (errCode === '16') return null; // no parcel at exact coords

  const pc1 = extractXmlValue(xml, 'pc1');
  const pc2 = extractXmlValue(xml, 'pc2');
  if (!pc1 || !pc2) return null;

  return {
    refcat:  pc1 + pc2,
    pc1, pc2,
    address: extractXmlValue(xml, 'ldt') || null,
    url:     `https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCListaBienes.aspx?rc1=${pc1}&rc2=${pc2}`
  };
}

// Try exact coords then small offsets
async function lookupWithOffsets(prop) {
  let result = await lookupByCoords(prop);
  if (result) return result;

  console.log('  ↪ exact coords missed, trying offsets...');
  const offsets = [
    [0.0002,0],[-0.0002,0],[0,0.0002],[0,-0.0002],
    [0.0002,0.0002],[-0.0002,-0.0002],
    [0.0004,0],[-0.0004,0],[0,0.0004],[0,-0.0004]
  ];
  for (const [dLng, dLat] of offsets) {
    await sleep(400);
    const shifted = { ...prop, lat: prop.lat+dLat, lng: prop.lng+dLng };
    result = await lookupByCoords(shifted);
    if (result) {
      console.log(`  ✅ found with offset [${dLng}, ${dLat}]`);
      return result;
    }
  }
  return null;
}

// Validate Resales refcat exists in Catastro
async function validateResalesRefcat(refcat, municipio) {
  if (!refcat) return false;
  const pc1 = refcat.substring(0, 7);
  const pc2 = refcat.substring(7, 14);
  const url = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/` +
    `OVCCallejero.asmx/Consulta_DNPRC?Provincia=MALAGA&Municipio=${encodeURIComponent(municipio)}&RC=${refcat}`;
  try {
    const res = await fetch(url, { timeout: 10000 });
    const xml = await res.text();
    const errCode = extractXmlValue(xml, 'cod');
    if (errCode === '5') return false; // "no existe ningún inmueble"
    const count = extractXmlValue(xml, 'cudnp');
    return count && parseInt(count) > 0;
  } catch(e) {
    return null; // unknown
  }
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  const force = process.argv.includes('--force');
  console.log(`\nPreos Catastro enrichment — ${PROPERTIES.length} properties`);
  console.log(force ? '⚡ Force mode\n' : '📦 Normal mode\n');

  const stats = { verified:0, high:0, medium:0, low:0, unverified:0, gps_only:0, failed:0, skipped:0 };

  for (const prop of PROPERTIES) {
    console.log(`\n[${prop.id}] ${prop.location}`);

    // Check cache
    const doc = await db.collection('enrichment').doc(prop.id).get();
    if (!force && doc.exists && doc.data().catastro?.cachedAt) {
      const ageDays = (Date.now() - new Date(doc.data().catastro.cachedAt).getTime()) / 86400000;
      if (ageDays < 90) {
        console.log(`  ⏭  cached (${ageDays.toFixed(1)}d) — skipping`);
        stats.skipped++;
        continue;
      }
    }

    try {
      // 1. GPS lookup
      const gps = await lookupWithOffsets(prop);
      await sleep(1000);

      // 2. Validate Resales refcat
      let resalesValid = null;
      if (prop.resales_refcat) {
        console.log(`  🔍 validating Resales refcat: ${prop.resales_refcat}`);
        resalesValid = await validateResalesRefcat(prop.resales_refcat, prop.location);
        console.log(`  ${resalesValid ? '✅' : '❌'} Resales refcat ${resalesValid ? 'exists' : 'NOT found'} in Catastro`);
        await sleep(1000);
      }

      // 3. Confidence algorithm
      const confidence = computeConfidence(
        gps?.refcat    || null,
        prop.resales_refcat || null,
        gps?.address   || null,
        prop.location  || null
      );

      // 4. Build Firestore record
      const catastro = {
        refcat_gps:          gps?.refcat     || null,
        refcat_resales:      prop.resales_refcat || null,
        resales_refcat_valid: resalesValid,
        address_catastro:    gps?.address    || null,
        url_gps:             gps?.url        || null,
        url_resales:         prop.resales_refcat
          ? `https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCListaBienes.aspx?rc1=${prop.resales_refcat.substring(0,7)}&rc2=${prop.resales_refcat.substring(7,14)}`
          : null,
        best_refcat:         confidence.best_refcat,
        best_refcat_url:     confidence.best_refcat
          ? `https://www1.sedecatastro.gob.es/CYCBienInmueble/OVCListaBienes.aspx?rc1=${confidence.best_refcat.substring(0,7)}&rc2=${confidence.best_refcat.substring(7,14)}`
          : null,
        confidence:          confidence.confidence,
        match_status:        confidence.status,
        flag_review:         confidence.flag_review,
        note:                confidence.note,
        cachedAt:            new Date().toISOString()
      };

      await db.collection('enrichment').doc(prop.id)
        .set({ catastro }, { merge: true });

      const icon = {
        verified:'✅', high:'🟢', medium:'🟡',
        low:'🔴', unverified:'⚠️', gps_only:'📍'
      }[confidence.confidence] || '❓';

      console.log(`  ${icon} ${confidence.confidence.toUpperCase()} — ${confidence.note}`);
      console.log(`  💾 best_refcat: ${catastro.best_refcat}`);
      stats[confidence.confidence]++;

    } catch(e) {
      console.error(`  ❌ error: ${e.message}`);
      stats.failed++;
    }

    console.log('  ⏳ waiting 3s...');
    await sleep(3000);
  }

  console.log('\n─────────────────────────────────');
  console.log('Results:');
  console.log(`  ✅ Verified:    ${stats.verified}`);
  console.log(`  🟢 High:        ${stats.high}`);
  console.log(`  🟡 Medium:      ${stats.medium}`);
  console.log(`  🔴 Low:         ${stats.low}`);
  console.log(`  ⚠️  Unverified:  ${stats.unverified}`);
  console.log(`  📍 GPS only:    ${stats.gps_only}`);
  console.log(`  ⏭  Skipped:     ${stats.skipped}`);
  console.log(`  ❌ Failed:      ${stats.failed}`);
  console.log('─────────────────────────────────\n');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
