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
  const city  = norm(p.city || '');
  const nbhd  = norm(p.neighbourhood || '');
  const title = norm(p.title || '');
  const loc   = norm(p.location || '');

  if (city === q)                    return 100;
  if (nbhd === q)                    return 80;
  if (city.startsWith(q))            return 60;
  if (nbhd.startsWith(q))            return 55;
  if (title.includes(q))             return 40;
  if (loc.includes(q))               return 20;
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

  const cities = new Set();
  const nbhds  = new Map(); // neighbourhood → city
  const titles = [];

  for (const p of props) {
    const city = p.city || '';
    const nbhd = p.neighbourhood || '';
    const title = p.title || '';

    if (city && norm(city).startsWith(q)) cities.add(city);
    if (nbhd && nbhd !== city && norm(nbhd).startsWith(q)) nbhds.set(nbhd, city);
    if (title && norm(title).includes(q) && titles.length < 2) {
      titles.push({ title, id: p.id });
    }
  }

  const suggestions = [];

  for (const city of cities) {
    suggestions.push({ type: 'city', text: city, secondary: 'Ciudad' });
  }
  for (const [nbhd, city] of nbhds) {
    suggestions.push({ type: 'neighbourhood', text: nbhd, secondary: city });
  }
  for (const { title, id } of titles) {
    suggestions.push({ type: 'property', text: title, secondary: 'Propiedad', id });
  }

  // Cap at 6 before adding the catch-all
  const capped = suggestions.slice(0, 6);
  capped.push({ type: 'all', text: query.trim(), secondary: '' });
  return capped;
}
