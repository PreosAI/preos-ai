/**
 * properties.js — Property data access layer.
 * Exports: getAllProperties, getPropertyById, searchProperties, getSuggestions, formatPrice
 */

const PROPERTIES_URL = 'data/properties.json';
let _cache = null;

async function getAllProperties() {
  if (_cache) return _cache;
  const res = await fetch(PROPERTIES_URL);
  _cache = await res.json();
  return _cache;
}

async function getPropertyById(id) {
  const props = await getAllProperties();
  return props.find(p => p.id === id) || null;
}

function formatPrice(price) {
  return '€' + Number(price).toLocaleString('es-ES');
}

// Normalise string for accent-insensitive comparison
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function scoreProperty(p, query) {
  const q = norm(query);
  if (!q) return 0;

  // Strip " provincia" suffix if present
  const cleanQ = q.replace(/\s*provincia\s*$/, '').trim();

  const province = norm(p.province || '');
  const city     = norm(p.city || '');
  const area     = norm(p.area || '');
  const nbhd     = norm(p.neighbourhood || '');
  const title    = norm(p.title || '');
  const loc      = norm(p.location || '');

  // Province search — return ALL properties in the province
  if (q.includes('provincia') && province === cleanQ) return 85;

  if (city === cleanQ)               return 100;
  if (area === cleanQ)               return 95;
  if (nbhd === cleanQ && nbhd !== city) return 80;
  if (city.startsWith(cleanQ))       return 60;
  if (area.startsWith(cleanQ))       return 55;
  if (nbhd.startsWith(cleanQ))       return 50;
  if (area.includes(cleanQ))         return 40;
  if (title.includes(cleanQ))        return 35;
  if (loc.includes(cleanQ))          return 20;
  return 0;
}

async function searchProperties(filters = {}) {
  const props = await getAllProperties();
  const {
    query, type, minPrice, maxPrice, minBedrooms,
    minSize, maxSize, features, has3dTour, status,
    yearBuiltMin, yearBuiltMax, bathrooms
  } = filters;

  let results = props.filter(p => {
    if (type && type !== 'todos' && p.type.toLowerCase() !== type.toLowerCase()) return false;
    if (minPrice && p.price < minPrice) return false;
    if (maxPrice && maxPrice > 0 && p.price > maxPrice) return false;
    if (minBedrooms && minBedrooms > 0 && p.bedrooms < minBedrooms) return false;
    if (bathrooms && bathrooms > 0 && (p.bathrooms || 0) < bathrooms) return false;
    if (minSize && minSize > 0 && (p.size_m2 || 0) < minSize) return false;
    if (maxSize && maxSize > 0 && (p.size_m2 || 0) > maxSize) return false;
    if (has3dTour) { if (!p.has_3d_tour) return false; }
    if (status && status !== 'all') {
      if (status === 'obra_nueva' && !p.obra_nueva) return false;
      if (status === 'resale' && (p.obra_nueva || p.status === 'bank')) return false;
      if (status === 'bank' && p.status !== 'bank') return false;
    }
    if (yearBuiltMin && yearBuiltMin > 0 && (p.year_built || 0) < yearBuiltMin) return false;
    if (yearBuiltMax && yearBuiltMax > 0 && (p.year_built || 9999) > yearBuiltMax) return false;
    if (features && features.length > 0) {
      const pFeats = p.features || [];
      for (const f of features) {
        if (!pFeats.includes(f)) return false;
      }
    }
    return true;
  });

  if (query && query.trim()) {
    results = results
      .map(p => ({ p, score: scoreProperty(p, query.trim()) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.p.price - a.p.price)
      .map(({ p }) => p);
  } else {
    results = results.sort((a, b) =>
      new Date(b.listed_date || 0) - new Date(a.listed_date || 0)
    );
  }

  return results;
}

async function getSuggestions(query) {
  if (!query || query.trim().length < 1) return [];
  const props = await getAllProperties();
  const q = norm(query.trim());

  const provinces      = new Map(); // province name → count
  const cities         = new Map(); // city name → province
  const areas          = new Map(); // area name → city
  const neighbourhoods = new Map(); // neighbourhood → city (only if different from city)
  const titles         = [];

  for (const p of props) {
    const province = p.province || '';
    const city     = p.city || '';
    const area     = p.area || '';
    const nbhd     = p.neighbourhood || '';
    const title    = p.title || '';

    // Province match
    if (province && norm(province).startsWith(q)) {
      provinces.set(province, (provinces.get(province) || 0) + 1);
    }

    // City match
    if (city && norm(city).startsWith(q)) {
      cities.set(city, province);
    }

    // Area match — both startsWith and contains
    if (area && norm(area).startsWith(q)) {
      areas.set(area, city);
    } else if (area && norm(area).includes(q)) {
      areas.set(area, city);
    }

    // Neighbourhood match — only if different from city
    if (nbhd && nbhd !== city && norm(nbhd).startsWith(q)) {
      neighbourhoods.set(nbhd, city);
    }

    // Property title match
    if (title && norm(title).includes(q) && titles.length < 2) {
      titles.push({ text: title, id: p.id });
    }
  }

  const suggestions = [];

  // 1. Province suggestions
  for (const [province, count] of provinces) {
    suggestions.push({
      type: 'province',
      text: province,
      secondary: `Provincia · ${count} ${count === 1 ? 'propiedad' : 'propiedades'}`,
      searchValue: province + ' provincia'
    });
  }

  // 2. City suggestions
  for (const [city, province] of cities) {
    suggestions.push({
      type: 'city',
      text: city,
      secondary: province ? `Ciudad · ${province}` : 'Ciudad',
      searchValue: city
    });
  }

  // 3. Area/zone suggestions
  for (const [area, city] of areas) {
    suggestions.push({
      type: 'area',
      text: area,
      secondary: city ? `Zona · ${city}` : 'Zona',
      searchValue: area
    });
  }

  // 4. Neighbourhood suggestions
  for (const [nbhd, city] of neighbourhoods) {
    suggestions.push({
      type: 'neighbourhood',
      text: nbhd,
      secondary: city ? `Barrio · ${city}` : 'Barrio',
      searchValue: nbhd
    });
  }

  // 5. Property title suggestions
  for (const { text, id } of titles) {
    suggestions.push({
      type: 'property',
      text,
      secondary: 'Propiedad',
      id,
      searchValue: text
    });
  }

  // Cap at 7 before adding the catch-all
  const capped = suggestions.slice(0, 7);
  capped.push({
    type: 'all',
    text: query.trim(),
    secondary: '',
    searchValue: query.trim()
  });
  return capped;
}
