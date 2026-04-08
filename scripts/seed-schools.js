/**
 * seed-schools.js
 *
 * Scrapes micole.net for all schools in Costa del Sol /
 * Málaga province municipalities and stores in Firestore.
 *
 * Strategy:
 *   1. For each municipality, fetch the buscador page
 *      which lists all schools there
 *   2. Parse school name, rating, reviews, address, type,
 *      methodology, price range, URL slug
 *   3. Store in Firestore 'schools' collection
 *      keyed by normalised slug
 *
 * Usage:
 *   node scripts/seed-schools.js
 *   node scripts/seed-schools.js --force
 */

const fetch  = require('node-fetch');
const { parse } = require('node-html-parser');
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

// All Costa del Sol + Málaga province relevant municipalities
// URL format: micole.net/buscador/colegios-malaga-{slug}
// Special case for Málaga city: /buscador/malaga-malaga
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
  { name: 'Torox',                slug: 'colegios-malaga-torrox' },
  { name: 'San Pedro Alcántara',  slug: 'colegios-malaga-san-pedro-de-alcantara' },
  { name: 'Monda',                slug: 'colegios-malaga-monda' },
  { name: 'Ojén',                 slug: 'colegios-malaga-ojen' },
  { name: 'Benahavís',            slug: 'colegios-malaga-benahavis' },
  { name: 'Istán',                slug: 'colegios-malaga-istan' },
];

// Also scrape these themed lists which contain rated schools
// from all over Málaga — high value targets
const THEMED_PAGES = [
  { name: 'Top Málaga',        url: 'https://www.micole.net/mejores-colegios-de-malaga' },
  { name: 'Internacionales',   url: 'https://www.micole.net/buscador/colegios-internacionales-malaga' },
  { name: 'Bilingües',         url: 'https://www.micole.net/buscador/colegios-bilingues-malaga' },
  { name: 'Top públicos',      url: 'https://www.micole.net/mejores-colegios-publicos-de-malaga' },
  { name: 'Top privados',      url: 'https://www.micole.net/mejores-colegios-privados-de-malaga' },
];

const BASE = 'https://www.micole.net/buscador/';

async function scrapePage(url, label) {
  console.log(`  → ${label}: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 25000
    });

    if (res.status === 404) {
      console.log(`    ⚠️  404 — skipping`);
      return [];
    }
    if (!res.ok) {
      console.log(`    ⚠️  ${res.status} — skipping`);
      return [];
    }

    const html = await res.text();
    const root = parse(html);
    const schools = [];

    // School cards contain a link with /malaga/ in href
    const links = root.querySelectorAll('h2 a[href*="/malaga/"]');
    console.log(`    found ${links.length} school links`);

    for (const link of links) {
      try {
        const rawName = link.text.trim();
        // Skip duplicate text — micole repeats the name twice in the link
        const name = rawName.split('\n')[0].trim();
        if (!name || name.length < 5) continue;

        const href = link.getAttribute('href') || '';
        const fullUrl = href.startsWith('http')
          ? href : 'https://www.micole.net' + href;

        // Parent card context for metadata
        // Try different parent levels
        let card = link.closest('article');
        if (!card) {
          let el = link.parentElement;
          for (let i = 0; i < 6 && el; i++) {
            if (el.text && el.text.length > 100) { card = el; break; }
            el = el.parentElement;
          }
        }
        if (!card) continue;

        const cardText = card.text || '';

        // Rating: look for pattern "4.4" near "valoraciones"
        const ratingMatch = cardText.match(/(\d\.\d)\s*\n.*?\((\d+)\s*valoracion/s);
        const rating      = ratingMatch ? parseFloat(ratingMatch[1]) : null;
        const reviews     = ratingMatch ? parseInt(ratingMatch[2]) : 0;

        // Address: text with comma and a town name
        const addrMatch = cardText.match(/((?:Calle|Avenida|Av\.|C\/|Plaza|Paseo|Carretera|Camino|Ronda|Urbanización|Urb\.)[^,\n]{3,50},\s*[A-ZÁÉÍÓÚ][^,\n]{2,30})/i);
        const address = addrMatch ? addrMatch[1].trim() : null;

        // Municipality from URL
        const urlParts  = fullUrl.replace('https://www.micole.net/', '').split('/');
        const municipio = urlParts[1] || null;

        // Type
        let tipo = 'Público';
        if (cardText.includes('Privado'))    tipo = 'Privado';
        if (cardText.includes('Concertado')) tipo = 'Concertado';

        // Methodology
        let metodologia = null;
        if (cardText.includes('Internacional'))              metodologia = 'Internacional';
        else if (/Bilingüe|Bilingue/i.test(cardText))        metodologia = 'Bilingüe';
        else if (cardText.includes('Idiomas'))               metodologia = 'Idiomas';

        // Price
        let precio = null;
        if (cardText.includes('>700'))             precio = '>700€';
        else if (cardText.includes('300-700'))     precio = '300-700€';
        else if (cardText.includes('100-300') ||
                 cardText.includes('100 y 300'))   precio = '100-300€';
        else if (/<100|0€\s*o/i.test(cardText))   precio = '<100€';

        // Stage (type of school)
        let etapa = 'Colegio';
        if (/instituto/i.test(name) || /I\.E\.S\./i.test(name)) etapa = 'Instituto';
        else if (/infantil|guardería|nursery|baby/i.test(name)) etapa = 'Infantil';
        else if (/universidad/i.test(name))                      etapa = 'Universidad';

        const slug = slugify(name);
        if (!slug) continue;

        schools.push({
          name, slug, url: fullUrl,
          rating, reviews,
          address, municipio, tipo,
          metodologia, precio, etapa,
          source: 'micole.net'
        });
      } catch(e) {
        // skip malformed
      }
    }

    return schools;

  } catch(e) {
    console.log(`    ❌ error: ${e.message}`);
    return [];
  }
}

async function main() {
  const force = process.argv.includes('--force');
  console.log('\n🏫 Preos School Database Seeder — micole.net');
  console.log(`Mode: ${force ? '⚡ force' : '📦 normal'}\n`);

  const allSchools = new Map(); // slug → data (deduplicates across pages)

  // 1. Scrape themed/ranking pages (highest quality schools)
  console.log('━━━ Themed pages ━━━');
  for (const page of THEMED_PAGES) {
    const schools = await scrapePage(page.url, page.name);
    for (const s of schools) {
      if (!allSchools.has(s.slug)) allSchools.set(s.slug, s);
    }
    await sleep(2500);
  }

  // 2. Scrape per-municipality pages
  console.log('\n━━━ Municipality pages ━━━');
  for (const muni of MUNICIPALITIES) {
    const url = BASE + muni.slug;
    const schools = await scrapePage(url, muni.name);
    for (const s of schools) {
      if (!allSchools.has(s.slug)) allSchools.set(s.slug, s);
    }
    await sleep(2500);
  }

  console.log(`\n📊 Total unique schools collected: ${allSchools.size}`);

  // 3. Save to Firestore
  console.log('\n💾 Saving to Firestore collection "schools"...\n');
  let saved = 0, skipped = 0, failed = 0;

  for (const [slug, school] of allSchools) {
    try {
      if (!force) {
        const existing = await db.collection('schools').doc(slug).get();
        if (existing.exists) { skipped++; continue; }
      }

      await db.collection('schools').doc(slug).set({
        ...school,
        updatedAt: new Date().toISOString()
      });

      const stars = school.rating
        ? (school.rating >= 4.5 ? '⭐' : school.rating >= 4.0 ? '🟢' : '🟡')
        : '⚪';
      const rating = school.rating
        ? `${school.rating} (${school.reviews}v)` : 'no rating';
      console.log(`  ${stars} ${rating} [${school.tipo}] ${school.name}`);
      saved++;
      await sleep(50);
    } catch(e) {
      console.error(`  ❌ ${school.name}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done`);
  console.log(`   Saved:   ${saved}`);
  console.log(`   Skipped: ${skipped} (already in DB)`);
  console.log(`   Failed:  ${failed}`);
  console.log(`   Total in DB: ~${saved + skipped}\n`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
