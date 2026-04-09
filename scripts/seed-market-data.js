/**
 * seed-market-data.js — Seed Firestore market_data collection with Costa del Sol municipalities.
 *
 * Usage:
 *   node scripts/seed-market-data.js
 *
 * Requires:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account JSON, OR
 *   - Running in a GCP environment with Application Default Credentials
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MARKET_DATA = [
  { slug: 'malaga',          name: 'Málaga',          pricePerM2: 3564, yoyChange: 11.7, source: 'RealAdvisor / Ministerio de Transportes', confidence: 'high',   updatedAt: '2026-04' },
  { slug: 'marbella',        name: 'Marbella',        pricePerM2: 4270, yoyChange: 18.0, source: 'Ministerio de Transportes Q4 2025',        confidence: 'high',   updatedAt: '2026-01' },
  { slug: 'estepona',        name: 'Estepona',         pricePerM2: 3100, yoyChange: 14.2, source: 'Ministerio de Transportes Q4 2025',        confidence: 'high',   updatedAt: '2026-01' },
  { slug: 'mijas',           name: 'Mijas',            pricePerM2: 2850, yoyChange: 12.5, source: 'Ministerio de Transportes Q4 2025',        confidence: 'high',   updatedAt: '2026-01' },
  { slug: 'benalmadena',     name: 'Benalmádena',      pricePerM2: 2780, yoyChange:  9.8, source: 'Ministerio de Transportes Q4 2025',        confidence: 'high',   updatedAt: '2026-01' },
  { slug: 'fuengirola',      name: 'Fuengirola',       pricePerM2: 2640, yoyChange:  8.3, source: 'Ministerio de Transportes Q4 2025',        confidence: 'high',   updatedAt: '2026-01' },
  { slug: 'torrox',          name: 'Torrox',           pricePerM2: 2100, yoyChange:  7.1, source: 'Ministerio de Transportes Q4 2025',        confidence: 'medium', updatedAt: '2026-01' },
  { slug: 'nerja',           name: 'Nerja',            pricePerM2: 2920, yoyChange: 13.4, source: 'Ministerio de Transportes Q4 2025',        confidence: 'medium', updatedAt: '2026-01' },
  { slug: 'velez-malaga',    name: 'Vélez-Málaga',     pricePerM2: 1680, yoyChange:  5.2, source: 'Ministerio de Transportes Q4 2025',        confidence: 'medium', updatedAt: '2026-01' },
  { slug: 'coin',            name: 'Coín',             pricePerM2: 1540, yoyChange:  6.8, source: 'Ministerio de Transportes Q4 2025',        confidence: 'medium', updatedAt: '2026-01' },
  { slug: 'alhaurin-de-la-torre', name: 'Alhaurín de la Torre', pricePerM2: 1980, yoyChange: 9.1, source: 'Ministerio de Transportes Q4 2025', confidence: 'medium', updatedAt: '2026-01' },
  { slug: 'alhaurin-el-grande',   name: 'Alhaurín el Grande',   pricePerM2: 1720, yoyChange: 7.5, source: 'Ministerio de Transportes Q4 2025', confidence: 'medium', updatedAt: '2026-01' },
  { slug: 'torremolinos',    name: 'Torremolinos',     pricePerM2: 2560, yoyChange: 10.2, source: 'Ministerio de Transportes Q4 2025',        confidence: 'high',   updatedAt: '2026-01' },
  { slug: 'rincon-de-la-victoria', name: 'Rincón de la Victoria', pricePerM2: 2180, yoyChange: 8.9, source: 'Ministerio de Transportes Q4 2025', confidence: 'medium', updatedAt: '2026-01' },
  { slug: 'manilva',         name: 'Manilva',          pricePerM2: 2340, yoyChange: 11.0, source: 'Ministerio de Transportes Q4 2025',        confidence: 'medium', updatedAt: '2026-01' },
];

async function seed() {
  console.log(`Seeding ${MARKET_DATA.length} municipalities into market_data...`);
  const batch = db.batch();

  for (const entry of MARKET_DATA) {
    const ref = db.collection('market_data').doc(entry.slug);
    batch.set(ref, {
      name:        entry.name,
      pricePerM2:  entry.pricePerM2,
      yoyChange:   entry.yoyChange,
      source:      entry.source,
      confidence:  entry.confidence,
      updatedAt:   entry.updatedAt,
    });
  }

  await batch.commit();
  console.log('Done. Remember to add this Firestore security rule manually:');
  console.log('  match /market_data/{docId} { allow read: if true; allow write: if false; }');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
