/**
 * import-schools.js
 * Imports the scraped schools JSON into Firestore.
 * Run after scraper.html has downloaded the JSON.
 * Usage: node scripts/import-schools.js [path-to-json]
 */
const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');

let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing serviceAccount.json'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function main() {
  const jsonPath = process.argv[2] ||
    path.join(require('os').homedir(), 'Downloads', 'schools-costas-del-sol.json');

  if (!fs.existsSync(jsonPath)) {
    console.error('JSON file not found:', jsonPath);
    console.error('Usage: node import-schools.js path/to/schools-costas-del-sol.json');
    process.exit(1);
  }

  const schools = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`\n📥 Importing ${schools.length} schools into Firestore...\n`);

  let saved = 0, skipped = 0, failed = 0;
  for (const school of schools) {
    if (!school.slug) { skipped++; continue; }
    try {
      await db.collection('schools').doc(school.slug).set({
        ...school, updatedAt: new Date().toISOString()
      }, { merge: true });
      const icon = !school.rating ? '⚪' :
        school.rating >= 4.5 ? '⭐' :
        school.rating >= 4.0 ? '🟢' : '🟡';
      console.log(`  ${icon} ${school.rating || '?'} [${school.tipo}] ${school.name}`);
      saved++;
    } catch(e) {
      console.error(`  ❌ ${school.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done — saved:${saved} skipped:${skipped} failed:${failed}\n`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
