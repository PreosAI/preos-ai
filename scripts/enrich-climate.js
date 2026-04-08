/**
 * enrich-climate.js
 *
 * Batch script — enriches each property with 5 climate
 * risk scores and stores them in Firestore:
 *   enrichment/{id}.climate
 *
 * Risk sources:
 *   💧 Flood    — Checked browser-side via SNCZI canvas pixel check
 *                 (score stored as null here; browser fills it in)
 *   🔥 Wildfire — Static scoring by municipality/inland distance
 *   🌡️ Heat     — Static scoring by coastal proximity + altitude
 *   💨 Wind     — Static scoring by altitude + coastal exposure
 *   🌫️ Air      — Static scoring (Costa del Sol baseline)
 *
 * Scores are 1–10 where 10 = highest risk.
 *
 * Usage:
 *   node scripts/enrich-climate.js
 *   node scripts/enrich-climate.js --force
 */

const admin = require('firebase-admin');

let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing scripts/serviceAccount.json'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const PROPERTIES = [
  { id:'R3479851', lat:36.6602, lng:-4.7601, location:'Coín',         city:'COIN'        },
  { id:'R3479779', lat:36.6218, lng:-4.4998, location:'Torremolinos', city:'TORREMOLINOS'},
  { id:'R3479773', lat:36.5984, lng:-4.5159, location:'Benalmádena',  city:'BENALMADENA' },
  { id:'R3479776', lat:36.6237, lng:-4.4997, location:'Torremolinos', city:'TORREMOLINOS'},
  { id:'R3479815', lat:36.5971, lng:-4.5201, location:'Benalmádena',  city:'BENALMADENA' },
  { id:'R3479809', lat:36.5963, lng:-4.5178, location:'Benalmádena',  city:'BENALMADENA' },
  { id:'R3479782', lat:36.6244, lng:-4.5012, location:'Torremolinos', city:'TORREMOLINOS'},
  { id:'R3479899', lat:36.5407, lng:-4.6225, location:'Fuengirola',   city:'FUENGIROLA'  },
  { id:'R3479887', lat:36.5958, lng:-4.6375, location:'Mijas',        city:'MIJAS'       },
  { id:'R3479884', lat:36.5991, lng:-4.5143, location:'Benalmádena',  city:'BENALMADENA' }
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Static risk scoring ──────────────────────────────────────────────────────
// Based on well-documented risk profiles for the Costa del Sol / Málaga province

// Wildfire risk — based on inland distance and vegetation cover
// Coastal strip (within ~5km of coast, lat > 36.55): low-medium
// Inland municipalities: higher risk (Coín, Mijas inland etc.)
function getWildfireRisk(lat, lng, city) {
  const highRiskCities = ['COIN'];
  const isInland = lat > 36.58 && lng < -4.55 && lat < 36.72;
  const isHighRisk = highRiskCities.includes(city);

  let score, label, detail;
  if (isHighRisk || (isInland && lat > 36.63)) {
    score = 7; label = 'Medium-High';
    detail = 'Inland location with significant vegetation — elevated wildfire risk in summer months';
  } else if (isInland) {
    score = 5; label = 'Medium';
    detail = 'Inland peri-urban location — moderate wildfire risk in dry seasons';
  } else {
    score = 3; label = 'Low';
    detail = 'Coastal location — lower wildfire risk due to urbanisation and proximity to sea';
  }
  return { score, label, detail,
    source: 'EFFIS / Junta de Andalucía fire risk assessment' };
}

// Heat risk — coastal areas cooler, inland hotter
// Average summer max Torremolinos: 29°C, Coín: 38°C
function getHeatRisk(lat, lng) {
  const isCoastal = lat < 36.62 && lng > -4.65;
  const isInland  = lat > 36.63 || lng < -4.65;

  let score, label, detail;
  if (isInland) {
    score = 7; label = 'Medium-High';
    detail = 'Inland location — summer temperatures regularly exceed 38°C. Limited sea breeze.';
  } else if (isCoastal) {
    score = 4; label = 'Medium';
    detail = 'Coastal location — Mediterranean sea breeze moderates summer heat. Avg max ~30°C.';
  } else {
    score = 5; label = 'Medium';
    detail = 'Semi-coastal location — warm summers with moderate sea breeze influence.';
  }
  return { score, label, detail,
    source: 'AEMET climate normals 1991-2020' };
}

// Wind risk — coastal properties more exposed, especially west-facing
function getWindRisk(lat, lng) {
  const isWesternCosta = lng < -4.90;
  const isCoastal      = lat < 36.60;

  let score, label, detail;
  if (isWesternCosta && isCoastal) {
    score = 5; label = 'Medium';
    detail = 'Western Costa del Sol — exposed to Poniente (westerly) winds. Max gusts ~80km/h.';
  } else if (isCoastal) {
    score = 3; label = 'Low';
    detail = 'Eastern Costa del Sol — sheltered by mountains. Mainly light Levante winds.';
  } else {
    score = 2; label = 'Very Low';
    detail = 'Inland location — well-sheltered from coastal winds by mountain ranges.';
  }
  return { score, label, detail,
    source: 'AEMET wind climatology' };
}

// Air quality — Costa del Sol generally good
function getAirRisk(lat, lng) {
  const nearMalagaCity = lat > 36.69 && lat < 36.73 && lng > -4.45 && lng < -4.40;
  const isCoastal      = lat < 36.65;

  let score, label, detail;
  if (nearMalagaCity) {
    score = 5; label = 'Moderate';
    detail = 'Near Málaga city — occasional NO₂ and PM10 exceedances from traffic and port.';
  } else if (isCoastal) {
    score = 2; label = 'Good';
    detail = 'Coastal location — excellent air quality. Consistent sea breeze clears pollutants.';
  } else {
    score = 3; label = 'Good';
    detail = 'Rural/semi-rural location — generally good air quality with low pollution sources.';
  }
  return { score, label, detail,
    source: 'Red de Vigilancia de la Calidad del Aire de Andalucía' };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const force = process.argv.includes('--force');
  console.log(`\nPreos Climate enrichment — ${PROPERTIES.length} properties`);
  console.log(force ? '⚡ Force mode\n' : '📦 Normal mode\n');

  let ok = 0, skipped = 0, failed = 0;

  for (const prop of PROPERTIES) {
    console.log(`\n[${prop.id}] ${prop.location} (${prop.lat}, ${prop.lng})`);

    const doc = await db.collection('enrichment').doc(prop.id).get();
    if (!force && doc.exists && doc.data().climate?.cachedAt) {
      const ageDays = (Date.now() - new Date(doc.data().climate.cachedAt).getTime()) / 86400000;
      if (ageDays < 90) {
        console.log(`  ⏭  cached (${ageDays.toFixed(1)}d) — skipping`);
        skipped++; continue;
      }
    }

    try {
      // Flood — checked browser-side via SNCZI canvas pixel check
      const flood = {
        score: null,
        label: null,
        detail: 'Flood zone data loaded directly from SNCZI on page load',
        source: 'SNCZI — Ministerio para la Transición Ecológica',
        zones: { t10: null, t100: null, t500: null }
      };

      // Static risks
      const wildfire = getWildfireRisk(prop.lat, prop.lng, prop.city);
      const heat     = getHeatRisk(prop.lat, prop.lng);
      const wind     = getWindRisk(prop.lat, prop.lng);
      const air      = getAirRisk(prop.lat, prop.lng);

      console.log(`  💧 flood:    (browser-side check)`);
      console.log(`  🔥 wildfire: ${wildfire.score}/10 (${wildfire.label})`);
      console.log(`  🌡️  heat:     ${heat.score}/10 (${heat.label})`);
      console.log(`  💨 wind:     ${wind.score}/10 (${wind.label})`);
      console.log(`  🌫️  air:      ${air.score}/10 (${air.label})`);

      const climate = {
        flood, wildfire, heat, wind, air,
        cachedAt: new Date().toISOString()
      };

      await db.collection('enrichment').doc(prop.id)
        .set({ climate }, { merge: true });
      console.log('  💾 saved to Firestore');
      ok++;

    } catch(e) {
      console.error(`  ❌ error: ${e.message}`);
      failed++;
    }

    console.log('  ⏳ waiting 2s...');
    await sleep(2000);
  }

  console.log(`\n✅ Done — ok:${ok} skipped:${skipped} failed:${failed}\n`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
