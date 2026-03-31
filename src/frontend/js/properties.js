/**
 * properties.js — Data access layer for property listings.
 *
 * Currently loads from a local JSON file that mirrors the Resales Online API shape.
 * To switch to the real API, replace the fetch URL in _load() with the API endpoint
 * and map the response fields to the same property object shape.
 */

const PROPERTIES_URL = 'data/properties.json';

let _cache = null;

async function _load() {
  if (_cache) return _cache;
  const res = await fetch(PROPERTIES_URL);
  if (!res.ok) throw new Error('Failed to load properties: ' + res.status);
  _cache = await res.json();
  return _cache;
}

/** Returns all properties. */
async function getAllProperties() {
  return _load();
}

/** Returns a single property by id, or null if not found. */
async function getPropertyById(id) {
  const all = await _load();
  return all.find(p => p.id === id) || null;
}

/**
 * Filters properties by the given criteria.
 * @param {Object} filters
 * @param {string}  [filters.type]        - Property type: 'Villa', 'Apartamento', 'Adosado'
 * @param {string}  [filters.location]    - Substring match on location
 * @param {number}  [filters.minPrice]    - Minimum price
 * @param {number}  [filters.maxPrice]    - Maximum price (0 or null = no limit)
 * @param {number}  [filters.minBedrooms] - Minimum number of bedrooms
 */
async function searchProperties(filters = {}) {
  const all = await _load();
  return all.filter(p => {
    if (filters.type && filters.type !== 'todos') {
      if (p.type.toLowerCase() !== filters.type.toLowerCase()) return false;
    }
    if (filters.location) {
      if (!p.location.toLowerCase().includes(filters.location.toLowerCase())) return false;
    }
    if (filters.minPrice != null && filters.minPrice > 0) {
      if (p.price < filters.minPrice) return false;
    }
    if (filters.maxPrice != null && filters.maxPrice > 0) {
      if (p.price > filters.maxPrice) return false;
    }
    if (filters.minBedrooms != null && filters.minBedrooms > 0) {
      if (p.bedrooms < filters.minBedrooms) return false;
    }
    return true;
  });
}

/** Formats a price number as a Spanish locale string: €285.000 */
function formatPrice(price) {
  return '€\u00a0' + price.toLocaleString('es-ES');
}
