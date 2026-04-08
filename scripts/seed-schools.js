/**
 * seed-schools.js
 * Scrapes micole.net — all Costa del Sol schools into Firestore.
 * Uses raw HTML regex parsing (micole has no <article> tags).
 */

const fetch  = require('node-fetch');
const admin  = require('firebase-admin');

let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing serviceAccount.json'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function dedup(name) {
  // micole repeats name: "Colegio X Colegio X" → "Colegio X"
  const t = name.trim();
  const half = t.substring(0, Math.floor(t.length / 2)).trim();
  if (half.length > 4 && t === half + ' ' + half) return half;
  // Also handle odd-length duplicates
  const words = t.split(' ');
  const mid = Math.floor(words.length / 2);
  const a = words.slice(0, mid).join(' ');
  const b = words.slice(mid).join(' ');
  if (a === b) return a;
  return t;
}

async function scrapePage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Accept': 'text/html'
    },
    timeout: 25000
  });
  if (res.status === 404) return [];
  if (!res.ok) { console.log(`    ⚠️  HTTP ${res.status}`); return []; }

  const html = await res.text();
  const schools = [];

  // Split page into blocks by <h2> — each school card starts with one
  const blocks = html.split('<h2');
  console.log(`    found ${blocks.length - 1} h2 blocks`);

  for (const block of blocks.slice(1)) {
    // Must contain a link to /malaga/{municipio}/colegio-...
    const linkMatch = block.match(/href="(\/malaga\/([^/]+)\/[^"]+)"/);
    if (!linkMatch) continue;

    const path      = linkMatch[1];
    const municipio = linkMatch[2];
    const fullUrl   = 'https://www.micole.net' + path;

    // Extract name from anchor text
    const nameMatch = block.match(/>([^<]{5,120})<\/a>/);
    if (!nameMatch) continue;
    const name = dedup(nameMatch[1].trim());
    if (!name || name.length < 4) continue;

    // Use up to 3000 chars after the h2 for metadata
    const ctx = block.substring(0, 3000);

    // Rating: digit.digit followed soon by a star image
    const ratingMatch = ctx.match(/(\d\.\d)\s*\n?\s*<img[^>]+star/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

    // Reviews: (NN valoraciones)
    const reviewMatch = ctx.match(/\((\d+)\s*valoraciones?\)/);
    const reviews = reviewMatch ? parseInt(reviewMatch[1]) : 0;

    // Address: line starting with a street keyword inside a tag
    const addrMatch = ctx.match(/>\s*((?:Calle|Avenida|Av\.|C\/|Plaza|Paseo|Carretera|Camino|Ronda|Urb\.|Urbanización|Polígono)[^<]{5,80})</i);
    const address = addrMatch ? addrMatch[1].trim() : null;

    // Tipo: look for exact tag content
    let tipo = 'Público';
    if (/>Privado</.test(ctx))    tipo = 'Privado';
    if (/>Concertado</.test(ctx)) tipo = 'Concertado';

    // Methodology
    let metodologia = null;
    if (/>Internacional</.test(ctx))               metodologia = 'Internacional';
    else if (/>Bilingüe</.test(ctx) ||
             />Bilingue</.test(ctx))               metodologia = 'Bilingüe';
    else if (/>Plurilingüe</.test(ctx) ||
             />Plurilingue</.test(ctx))             metodologia = 'Plurilingüe';
    else if (/>Idiomas</.test(ctx))                metodologia = 'Idiomas';

    // Price
    let precio = null;
    if (/>(&gt;700|>700)€</.test(ctx))            precio = '>700€';
    else if (/>300-700€</.test(ctx))              precio = '300-700€';
    else if (/>100-300€</.test(ctx))              precio = '100-300€';
    else if (/>(0€|&lt;100|<100)/.test(ctx))      precio = '<100€';

    // Stage
    let etapa = 'Colegio';
    if (/\bI\.E\.S\b|\bInstituto\b/i.test(name)) etapa = 'Instituto';
    else if (/infantil|guardería|nursery|baby/i.test(name)) etapa = 'Infantil';

    const slug = slugify(name);
    if (!slug) continue;

    schools.push({
      name, slug, url: fullUrl, municipio,
      rating, reviews,
      address, tipo, metodologia, precio, etapa,
      source: 'micole.net'
    });
  }

  return schools;
}

const MUNICIPALITIES = [
  { name: 'Málaga',               slug: 'malaga-malaga' },
  { name: 'Marbella',             slug: 'colegios-malaga-marbella' },
  { name: 'Fuengirola',           slug: 'colegios-malaga-fuengirola' },
  { name: 'Benalmádena',          slug: 'colegios-malaga-benalmadena' },
  { name: 'Torremolinos',         slug: 'colegios-malaga-torremolinos' },
  { name: 'Mijas',                slug: 'colegios-malaga-mijas' },
  { name: 'Estepona',             slug: 'colegios-malaga-estepona' },
  { name: 'Vélez-Málaga',         slug: 'colegios-malaga-velez-malaga' },
  { name: 'Rincón de la Victoria',slug: 'colegios-malaga-rincon-de-la-victoria' },
  { name: 'Alhaurín de la Torre', slug: 'colegios-malaga-alhaurin-de-la-torre' },
  { name: 'Alhaurín el Grande',   slug: 'colegios-malaga-alhaurin-el-grande' },
  { name: 'Nerja',                slug: 'colegios-malaga-nerja' },
  { name: 'Coín',                 slug: 'colegios-malaga-coin' },
  { name: 'Manilva',              slug: 'colegios-malaga-manilva' },
  { name: 'Casares',              slug: 'colegios-malaga-casares' },
  { name: 'Cártama',              slug: 'colegios-malaga-cartama' },
  { name: 'Torrox',               slug: 'colegios-malaga-torrox' },
  { name: 'San Pedro Alcántara',  slug: 'colegios-malaga-san-pedro-de-alcantara' },
  { name: 'Monda',                slug: 'colegios-malaga-monda' },
  { name: 'Ojén',                 slug: 'colegios-malaga-ojen' },
  { name: 'Benahavís',            slug: 'colegios-malaga-benahavis' },
  { name: 'Istán',                slug: 'colegios-malaga-istan' },
  { name: 'Marbella (San Pedro)', slug: 'colegios-malaga-san-pedro-de-alcantara' },
];

const THEMED = [
  'https://www.micole.net/mejores-colegios-de-malaga',
  'https://www.micole.net/buscador/colegios-internacionales-malaga',
  'https://www.micole.net/buscador/colegios-bilingues-malaga',
  'https://www.micole.net/mejores-colegios-publicos-de-malaga',
  'https://www.micole.net/mejores-colegios-privados-de-malaga',
];

async function main() {
  const force = process.argv.includes('--force');
  console.log('\n🏫 Preos School Database — micole.net scraper');
  console.log(force ? '⚡ Force\n' : '📦 Normal\n');

  const map = new Map();

  console.log('━━━ Themed pages ━━━');
  for (const url of THEMED) {
    console.log(`  ${url.split('/').pop()}`);
    const list = await scrapePage(url);
    for (const s of list) if (!map.has(s.slug)) map.set(s.slug, s);
    await sleep(2500);
  }

  console.log('\n━━━ Municipality pages ━━━');
  for (const m of MUNICIPALITIES) {
    const url = 'https://www.micole.net/buscador/' + m.slug;
    console.log(`  ${m.name}`);
    const list = await scrapePage(url);
    for (const s of list) if (!map.has(s.slug)) map.set(s.slug, s);
    await sleep(2500);
  }

  console.log(`\n📊 Unique schools scraped: ${map.size}`);

  // Print preview
  let rated = 0;
  for (const s of map.values()) if (s.rating) rated++;
  console.log(`   With ratings: ${rated} / ${map.size}`);

  // Save to Firestore
  console.log('\n💾 Saving to Firestore "schools"...\n');
  let saved = 0, skipped = 0;

  for (const [slug, school] of map) {
    try {
      if (!force) {
        const ex = await db.collection('schools').doc(slug).get();
        if (ex.exists) { skipped++; continue; }
      }
      await db.collection('schools').doc(slug).set({
        ...school, updatedAt: new Date().toISOString()
      });
      const icon = !school.rating ? '⚪' :
        school.rating >= 4.5 ? '⭐' :
        school.rating >= 4.0 ? '🟢' : '🟡';
      const r = school.rating ? `${school.rating}(${school.reviews}v)` : 'unrated';
      console.log(`  ${icon} ${r} [${school.tipo}] ${school.name}`);
      saved++;
      await sleep(80);
    } catch(e) {
      console.error(`  ❌ ${school.name}: ${e.message}`);
    }
  }

  console.log(`\n✅ saved:${saved} skipped:${skipped} total:~${saved+skipped}\n`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
