/**
 * enrich-postcode.js
 * Gets postcode for each property from GPS coords using
 * Nominatim reverse geocoding (free, no key needed).
 * Stores result in Firestore enrichment/{id}.postcode
 *
 * Usage: node scripts/enrich-postcode.js
 *        node scripts/enrich-postcode.js --force
 */

const fetch = require('node-fetch');
const admin = require('firebase-admin');
const props = require('../src/frontend/data/properties.json');

let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing serviceAccount.json'); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: sa.project_id
});
const db = admin.firestore();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getPostcode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse` +
    `?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Preos.ai/1.0 property enrichment' },
    timeout: 10000
  });
  if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
  const data = await res.json();
  return data.address?.postcode?.replace(/\s/g, '') || null;
}

async function main() {
  const force = process.argv.includes('--force');
  console.log('\n📮 Preos Postcode Enrichment — Nominatim\n');

  for (const prop of props) {
    const { id, lat, lng } = prop;
    if (!lat || !lng) { console.log(`⚠️  ${id}: no GPS`); continue; }

    if (!force) {
      const doc = await db.collection('enrichment').doc(id).get();
      if (doc.exists && doc.data()?.postcode) {
        console.log(`⏭️  ${id}: ${doc.data().postcode} (cached)`);
        continue;
      }
    }

    try {
      const postcode = await getPostcode(lat, lng);
      if (!postcode) { console.log(`⚠️  ${id}: no postcode found`); continue; }

      await db.collection('enrichment').doc(id).set(
        { postcode, postcodeUpdatedAt: new Date().toISOString() },
        { merge: true }
      );
      console.log(`✅ ${id}: ${postcode}`);
    } catch(e) {
      console.error(`❌ ${id}: ${e.message}`);
    }

    // Nominatim rate limit: 1 req/sec
    await sleep(1200);
  }

  console.log('\n✅ Done\n');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
