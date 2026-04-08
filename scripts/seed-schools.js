/**
 * seed-schools.js
 *
 * Instead of HTTP scraping (blocked by micole.net),
 * this script generates a browser-based scraper page.
 *
 * Run: node scripts/seed-schools.js
 * Then: open the generated scraper.html in Chrome
 * Finally: run the Firestore import with the downloaded JSON
 */

const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');

// ── 1. Generate the browser scraper HTML ─────────────────
const MUNICIPALITIES = [
  'colegios-malaga-benalmadena',
  'colegios-malaga-torremolinos',
  'colegios-malaga-fuengirola',
  'colegios-malaga-mijas',
  'colegios-malaga-marbella',
  'colegios-malaga-estepona',
  'colegios-malaga-san-pedro-de-alcantara',
  'colegios-malaga-nerja',
  'colegios-malaga-rincon-de-la-victoria',
  'colegios-malaga-alhaurin-de-la-torre',
  'colegios-malaga-alhaurin-el-grande',
  'colegios-malaga-velez-malaga',
  'colegios-malaga-coin',
  'colegios-malaga-manilva',
  'colegios-malaga-casares',
  'colegios-malaga-cartama',
  'colegios-malaga-torrox',
  'colegios-malaga-monda',
  'colegios-malaga-ojen',
  'colegios-malaga-benahavis',
  'malaga-malaga',
];

const THEMED = [
  'mejores-colegios-de-malaga',
  'colegios-internacionales-malaga',
  'colegios-bilingues-malaga',
  'mejores-colegios-publicos-de-malaga',
  'mejores-colegios-privados-de-malaga',
];

const allPages = [
  ...THEMED.map(s => `https://www.micole.net/buscador/${s}`),
  ...MUNICIPALITIES.map(s => `https://www.micole.net/buscador/${s}`)
];

const scraperHTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Preos School Scraper</title>
<style>
  body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #eee; }
  #log { white-space: pre; font-size: 12px; height: 400px; overflow-y: auto;
         background: #111; padding: 10px; border: 1px solid #333; }
  button { padding: 10px 20px; font-size: 16px; margin: 10px 5px;
           background: #CC0000; color: white; border: none;
           cursor: pointer; border-radius: 6px; }
  button:disabled { background: #555; cursor: default; }
  #status { font-size: 18px; margin: 10px 0; }
</style>
</head>
<body>
<h2>🏫 Preos School Scraper — micole.net</h2>
<div id="status">Ready. Click Start to begin scraping all ${allPages.length} pages.</div>
<button id="startBtn" onclick="runScraper()">▶ Start Scraping</button>
<button onclick="downloadJSON()" id="dlBtn" disabled>⬇ Download JSON</button>
<div id="log"></div>

<script>
const PAGES = ${JSON.stringify(allPages)};
const results = new Map();
let iframe;

function log(msg) {
  const el = document.getElementById('log');
  el.textContent += msg + '\\n';
  el.scrollTop = el.scrollHeight;
}

function slugify(name) {
  return name.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9\\s-]/g,'').trim().replace(/\\s+/g,'-');
}

function extractSchools(doc, url) {
  const schools = [];
  const links = doc.querySelectorAll(
    'a[href*="/malaga/"][href*="colegio"], a[href*="/malaga/"][href*="instituto"], a[href*="/malaga/"][href*="infantil"]'
  );
  links.forEach(a => {
    const name = a.textContent.trim().split('\\n')[0].trim();
    if (!name || name.length < 5) return;

    let card = a.parentElement;
    for (let i = 0; i < 8; i++) {
      if (card && card.innerText && card.innerText.length > 80) break;
      card = card?.parentElement;
    }
    const text = card?.innerText || '';

    const ratingMatch = text.match(/^(\\d\\.\\d)/m);
    const reviewMatch = text.match(/\\((\\d+)\\s*valoraciones?\\)/);
    const addrMatch   = text.match(/(Calle|Avenida|Camino|Plaza|Paseo|Carretera|Ronda|Av\\.)[^\\n,]{3,60},\\s*[^\\n,]{3,30}/i);

    let tipo = 'Público';
    if (text.includes('Privado')) tipo = 'Privado';
    if (text.includes('Concertado')) tipo = 'Concertado';

    let metodologia = null;
    if (text.includes('Internacional'))  metodologia = 'Internacional';
    else if (/Bilingüe|Plurilingüe/i.test(text)) metodologia = 'Bilingüe';
    else if (text.includes('Idiomas'))   metodologia = 'Idiomas';

    let precio = null;
    if (text.includes('>700€'))        precio = '>700€';
    else if (text.includes('300-700')) precio = '300-700€';
    else if (text.includes('100-300')) precio = '100-300€';
    else if (/<100|0€/.test(text))     precio = '<100€';

    let etapa = 'Colegio';
    if (/instituto|I\\.E\\.S/i.test(name))    etapa = 'Instituto';
    else if (/infantil|guardería|baby/i.test(name)) etapa = 'Infantil';

    const municipio = (new URL(a.href)).pathname.split('/')[2] || null;
    const slug = slugify(name);
    if (slug) schools.push({
      name, slug, url: a.href, municipio,
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      reviews: reviewMatch ? parseInt(reviewMatch[1]) : 0,
      address: addrMatch ? addrMatch[0].trim() : null,
      tipo, metodologia, precio, etapa,
      source: 'micole.net'
    });
  });
  return schools;
}

async function scrapePage(url, iframe) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 15000);
    iframe.onload = () => {
      clearTimeout(timeout);
      try {
        const schools = extractSchools(iframe.contentDocument, url);
        resolve(schools);
      } catch(e) { resolve([]); }
    };
    iframe.src = url;
  });
}

async function runScraper() {
  document.getElementById('startBtn').disabled = true;
  document.getElementById('status').textContent = 'Scraping...';

  // Create hidden iframe for loading pages
  iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;width:1200px;height:800px;';
  document.body.appendChild(iframe);

  for (let i = 0; i < PAGES.length; i++) {
    const url = PAGES[i];
    const label = url.split('/').pop();
    log(\`[\${i+1}/\${PAGES.length}] \${label}\`);

    const schools = await scrapePage(url, iframe);
    let added = 0;
    schools.forEach(s => {
      if (!results.has(s.slug)) { results.set(s.slug, s); added++; }
    });
    log(\`  → \${schools.length} schools (\${added} new) | total: \${results.size}\`);

    // Polite delay between pages
    await new Promise(r => setTimeout(r, 1500));
  }

  iframe.remove();
  document.getElementById('status').textContent =
    \`✅ Done! \${results.size} unique schools scraped.\`;
  document.getElementById('dlBtn').disabled = false;
  log('\\n🎉 Scraping complete! Click Download JSON to save the data.');
}

function downloadJSON() {
  const data = Array.from(results.values());
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schools-costas-del-sol.json';
  a.click();
  log(\`Downloaded \${data.length} schools as JSON.\`);
}
</script>
</body>
</html>`;

const outPath = path.join(__dirname, '..', 'scraper.html');
fs.writeFileSync(outPath, scraperHTML, 'utf8');
console.log(`\n✅ Scraper page generated: ${outPath}`);
console.log('\nNext steps:');
console.log('  1. Open scraper.html in Chrome');
console.log('  2. Click "Start Scraping" and wait ~2 minutes');
console.log('  3. Click "Download JSON" to save schools-costa-del-sol.json');
console.log('  4. Run: node scripts/import-schools.js\n');

// ── 2. Also generate the import script ───────────────────
const importScript = `/**
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
  console.log(\`\\n📥 Importing \${schools.length} schools into Firestore...\\n\`);

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
      console.log(\`  \${icon} \${school.rating || '?'} [\${school.tipo}] \${school.name}\`);
      saved++;
    } catch(e) {
      console.error(\`  ❌ \${school.name}: \${e.message}\`);
      failed++;
    }
  }

  console.log(\`\\n✅ Done — saved:\${saved} skipped:\${skipped} failed:\${failed}\\n\`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
`;

const importPath = path.join(__dirname, 'import-schools.js');
fs.writeFileSync(importPath, importScript, 'utf8');
console.log(`✅ Import script generated: ${importPath}\n`);
