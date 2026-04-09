/**
 * seed-market-data.js
 * Fetches real notarial data from penotariado.com ArcGIS API.
 * Stores two collections in Firestore:
 *
 *   market_data/{slug}         — municipality level (fallback)
 *   market_data_cp/{cp}        — postcode level (preferred)
 *
 * Each doc contains ALL property type breakdowns:
 *   priceNewFlat, priceResaleFlat, priceResaleHouse, priceAll
 *   transactionsNewFlat, transactionsResaleFlat, etc.
 *
 * tipo_construccion_id: 7=nueva, 9=segunda mano, 99=all
 * clase_finca_urbana_id: 14=piso, 15=unifamiliar, 99=all
 *
 * Firestore rules needed (add in Firebase Console):
 *   match /market_data/{docId}    { allow read: if true; allow write: if false; }
 *   match /market_data_cp/{docId} { allow read: if true; allow write: if false; }
 *
 * Usage: node scripts/seed-market-data.js
 */

const fetch = require('node-fetch');
const admin = require('firebase-admin');

let sa;
try { sa = require('./serviceAccount.json'); }
catch(e) { console.error('Missing serviceAccount.json'); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: sa.project_id
});
const db = admin.firestore();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(name) {
  return (name || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-');
}

const ARCGIS = 'https://services-eu1.arcgis.com/UpPGybwp9RK4YtZj/arcgis/rest/services';
const SOURCE = 'Portal Estadístico del Notariado';
const SOURCE_URL = 'https://penotariado.com/inmobiliario/buscador-precio-vivienda';

const MUNICIPALITIES = [
  'Torremolinos','Marbella','Fuengirola','Benalmádena','Estepona',
  'Mijas','Málaga','Nerja','Manilva','Torrox','Coín','Casares',
  'Vélez-Málaga','Rincón de la Victoria','Alhaurín de la Torre'
];

async function fetchLayer(layer, where, fields) {
  const url = ARCGIS +
    `/agol_precio_m2/FeatureServer/${layer}/query` +
    `?f=json&returnGeometry=false` +
    `&outFields=${fields.join(',')}` +
    `&where=${encodeURIComponent(where)}`;
  const res = await fetch(url, { timeout: 30000 });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.features || []).map(f => f.attributes);
}

// Build a structured doc from raw rows
// Each row has tipo_construccion_id + clase_finca_urbana_id
function buildDoc(rows, extra) {
  const get = (tipo, clase) => {
    const r = rows.find(r =>
      r.tipo_construccion_id === tipo &&
      r.clase_finca_urbana_id === clase
    );
    return r && !r.es_estimado ? r : null;
  };

  const newFlat     = get(7, 14);
  const newHouse    = get(7, 15);
  const resaleFlat  = get(9, 14);
  const resaleHouse = get(9, 15);
  const all         = get(99, 99);

  return {
    ...extra,
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    confidence: all ? 'high' : 'medium',
    updatedAt: new Date().toISOString().substring(0, 7),

    // All-types combined (AVM fallback)
    pricePerM2:   all?.precio_m2 || null,
    transactions: all?.total_informados || null,
    avgPrice:     all?.precio_medio || null,
    avgSizeM2:    all?.superficie_media || null,

    // New build flat (obra nueva piso)
    priceNewFlat:        newFlat?.precio_m2 || null,
    transactionsNewFlat: newFlat?.total_informados || null,

    // New build house (obra nueva unifamiliar)
    priceNewHouse:        newHouse?.precio_m2 || null,
    transactionsNewHouse: newHouse?.total_informados || null,

    // Resale flat (segunda mano piso) - most common
    priceResaleFlat:        resaleFlat?.precio_m2 || null,
    transactionsResaleFlat: resaleFlat?.total_informados || null,

    // Resale house (segunda mano unifamiliar)
    priceResaleHouse:        resaleHouse?.precio_m2 || null,
    transactionsResaleHouse: resaleHouse?.total_informados || null,
  };
}

async function seedMunicipalities() {
  console.log('\n── Municipality level (Layer 3) ──');
  const muniList = MUNICIPALITIES.map(m => `'${m}'`).join(',');
  const where =
    `name_prov='Málaga' AND name_muni IN (${muniList})`;
  const fields = ['name_muni','cod_muni','precio_m2','precio_medio',
    'superficie_media','total_informados','tipo_construccion_id',
    'clase_finca_urbana_id','es_estimado'];

  const rows = await fetchLayer(3, where, fields);
  console.log(`  Fetched ${rows.length} rows`);

  // Group by municipality
  const byMuni = {};
  for (const r of rows) {
    if (!byMuni[r.name_muni]) byMuni[r.name_muni] = [];
    byMuni[r.name_muni].push(r);
  }

  let saved = 0;
  for (const [muni, muniRows] of Object.entries(byMuni)) {
    const slug = slugify(muni);
    const codMuni = muniRows[0]?.cod_muni;
    const doc = buildDoc(muniRows, { slug, name: muni, cod_muni: String(codMuni || '') });
    await db.collection('market_data').doc(slug).set(doc);
    console.log(`  ✅ ${muni}: €${doc.pricePerM2}/m² | resale flat €${doc.priceResaleFlat}/m²`);
    saved++;
  }
  console.log(`  Saved ${saved} municipalities`);
}

async function seedPostcodes() {
  console.log('\n── Postcode level (Layer 4) ──');
  // Fetch all Málaga postcodes (295xx and 296xx)
  const where =
    `name_prov='Málaga' AND (cp LIKE '295%' OR cp LIKE '296%')`;
  const fields = ['cp','precio_m2','precio_medio','superficie_media',
    'total_informados','tipo_construccion_id','clase_finca_urbana_id',
    'es_estimado'];

  const rows = await fetchLayer(4, where, fields);
  console.log(`  Fetched ${rows.length} rows`);

  // Group by postcode
  const byCp = {};
  for (const r of rows) {
    if (!byCp[r.cp]) byCp[r.cp] = [];
    byCp[r.cp].push(r);
  }

  let saved = 0;
  for (const [cp, cpRows] of Object.entries(byCp)) {
    const doc = buildDoc(cpRows, { cp });
    await db.collection('market_data_cp').doc(cp).set(doc);
    console.log(`  ✅ ${cp}: €${doc.pricePerM2}/m² | resale flat €${doc.priceResaleFlat}/m²`);
    saved++;
    await sleep(50);
  }
  console.log(`  Saved ${saved} postcodes`);
}

async function main() {
  console.log('\n📊 Seeding market data from penotariado.com ArcGIS API...');
  await seedMunicipalities();
  await sleep(1000);
  await seedPostcodes();
  console.log('\n✅ All done\n');
  process.exit(0);
}
main().catch(e => { console.error('Failed:', e); process.exit(1); });
