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

const fetch = require('node-fetch');
const Jimp  = require('jimp');
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

// ── Flood risk via SNCZI WMS + jimp pixel check ──────────────────────────────
async function getFloodRisk(lat, lng) {
  const d    = 0.005;
  const bbox = `${lng-d},${lat-d},${lng+d},${lat+d}`;
  const W    = 256, H = 256;

  const periods = {
    t10:  { url: 'https://wms.mapama.gob.es/sig/agua/ZI_LaminasQ10/wms.aspx',
             layer: 'Z.I. con alta probabilidad' },
    t100: { url: 'https://wms.mapama.gob.es/sig/agua/ZI_LaminasQ100/wms.aspx',
             layer: 'Z.I. con probabilidad media u ocasional' },
    t500: { url: 'https://wms.mapama.gob.es/sig/agua/ZI_LaminasQ500/wms.aspx',
             layer: 'Z.I. con baja probabilidad o excepcional' }
  };

  async function checkPeriod(key) {
    try {
      const { url, layer } = periods[key];
      const tileUrl = `${url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
        `&LAYERS=${encodeURIComponent(layer)}&STYLES=&SRS=EPSG:4326` +
        `&BBOX=${bbox}&WIDTH=${W}&HEIGHT=${H}` +
        `&FORMAT=image/png&TRANSPARENT=FALSE`;

      const res = await fetch(tileUrl, { timeout: 15000 });
      if (!res.ok) return null;
      const buf = await res.buffer();
      const img = await Jimp.read(buf);

      // Scan all pixels for flood orange (R>200, G 80-220, B<50)
      let found = false;
      img.scan(0, 0, W, H, function(x, y, idx) {
        if (found) return;
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx+1];
        const b = this.bitmap.data[idx+2];
        if (r > 200 && g > 80 && g < 220 && b < 50) found = true;
      });
      return found;
    } catch(e) {
      console.warn(`  flood ${key} error: ${e.message}`);
      return null;
    }
  }

  console.log('  💧 checking SNCZI flood zones...');
  const t10  = await checkPeriod('t10');  await sleep(600);
  const t100 = await checkPeriod('t100'); await sleep(600);
  const t500 = await checkPeriod('t500'); await sleep(600);
  console.log(`  💧 T10:${t10} T100:${t100} T500:${t500}`);

  let score, label, detail;
  if (t10) {
    score = 9; label = 'High';
    detail = 'In high-probability flood zone (T=10 years).';
  } else if (t100) {
    score = 6; label = 'Medium';
    detail = 'In medium-probability flood zone (T=100 years).';
  } else if (t500) {
    score = 3; label = 'Low';
    detail = 'In low-probability flood zone (T=500 years).';
  } else if (t10 === false) {
    score = 1; label = 'Very Low';
    detail = 'Not in any SNCZI mapped flood zone.';
  } else {
    score = null; label = null;
    detail = 'Flood data inconclusive.';
  }

  return {
    score, label, detail,
    zones: { t10, t100, t500 },
    source: 'SNCZI — Ministerio para la Transición Ecológica'
  };
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
      const flood = await getFloodRisk(prop.lat, prop.lng);

      // Static risks
      const wildfire = getWildfireRisk(prop.lat, prop.lng, prop.city);
      const heat     = getHeatRisk(prop.lat, prop.lng);
      const wind     = getWindRisk(prop.lat, prop.lng);
      const air      = getAirRisk(prop.lat, prop.lng);

      console.log(`  💧 flood:    ${flood.score ?? '?'}/10 (${flood.label ?? 'unknown'})`);
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
