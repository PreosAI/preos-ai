/**
 * enrich-sun.js
 * Fetches monthly sun hours from PVGIS (EU Commission) for
 * each property and stores in Firestore enrichment/{id}.sun
 *
 * PVGIS endpoint (free, no key):
 * https://re.jrc.ec.europa.eu/api/v5_2/MRcalc
 *   ?lat={lat}&lon={lng}&outputformat=json&mr_dni=1
 *
 * H(h)_m = monthly mean daily global irradiance (Wh/m²/day)
 * Sun hours/day = H(h)_m / 1000
 *
 * Usage:
 *   node scripts/enrich-sun.js
 *   node scripts/enrich-sun.js --force
 */

const fetch  = require('node-fetch');
const admin  = require('firebase-admin');
const props  = require('../src/frontend/data/properties.json');

let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing serviceAccount.json'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MONTH_NAMES = [
  'Ene','Feb','Mar','Abr','May','Jun',
  'Jul','Ago','Sep','Oct','Nov','Dic'
];

async function fetchSunData(lat, lng) {
  const url = `https://re.jrc.ec.europa.eu/api/v5_2/PVcalc` +
    `?lat=${lat}&lon=${lng}&peakpower=1&loss=14&outputformat=json`;
  const res = await fetch(url, { timeout: 20000 });
  if (!res.ok) throw new Error(`PVGIS ${res.status}`);
  const data = await res.json();

  // Parse 12 monthly values
  const monthly = data.outputs?.monthly?.fixed || [];
  if (!monthly.length) throw new Error('No monthly data in PVGIS response');

  // H(i)_d = daily global irradiance in kWh/m²/day = peak sun hours
  const sunHours = monthly.map(m => ({
    month: m.month,
    name:  MONTH_NAMES[m.month - 1],
    hours: Math.round(m['H(i)_d'] * 10) / 10
  }));

  const juneHours     = sunHours.find(m => m.month === 6)?.hours;
  const decemberHours = sunHours.find(m => m.month === 12)?.hours;
  const annualAvg     = Math.round(
    (sunHours.reduce((s, m) => s + m.hours, 0) / 12) * 10
  ) / 10;

  return { monthly: sunHours, juneHours, decemberHours, annualAvg };
}

async function main() {
  const force = process.argv.includes('--force');
  console.log('\n☀️  Preos Sun Exposure Enrichment — PVGIS');
  console.log(force ? '⚡ Force\n' : '📦 Normal\n');

  for (const prop of props) {
    const { id, lat, lng } = prop;
    if (!lat || !lng) { console.log(`⚠️  ${id}: no GPS`); continue; }

    // Check if already enriched
    if (!force) {
      const doc = await db.collection('enrichment').doc(id).get();
      if (doc.exists && doc.data()?.sun?.cachedAt) {
        console.log(`⏭️  ${id}: already enriched`);
        continue;
      }
    }

    try {
      console.log(`☀️  ${id} (${lat}, ${lng})`);
      const sun = await fetchSunData(lat, lng);

      await db.collection('enrichment').doc(id).set(
        { sun: { ...sun, cachedAt: new Date().toISOString() } },
        { merge: true }
      );

      console.log(
        `   ✅ June: ${sun.juneHours}h | Dec: ${sun.decemberHours}h` +
        ` | Annual avg: ${sun.annualAvg}h/day`
      );
    } catch(e) {
      console.error(`   ❌ ${id}: ${e.message}`);
    }

    await sleep(1500); // polite delay for PVGIS
  }

  console.log('\n✅ Done\n');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
