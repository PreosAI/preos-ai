/**
 * properties.js — Property data access layer.
 *
 * Endpoints:
 *   /api/resales/listings-paged   server-side filter + cursor pagination (used by buscar.html)
 *   /api/resales/locations        aggregated city/area index for autocomplete
 *   /api/resales/property/<ref>   single-listing detail
 *   /api/resales/listings         legacy flat array — kept alive as a thin shim for
 *                                 index/favoritos/dashboard/agente-dashboard/mis-ofertas/visitas
 */

const RESALES_API_BASE      = 'https://preos-resales-proxy.azurewebsites.net/api/resales';
const RESALES_API_URL       = RESALES_API_BASE + '/listings';
const RESALES_PAGED_URL     = RESALES_API_BASE + '/listings-paged';
const RESALES_LOCATIONS_URL = RESALES_API_BASE + '/locations';

let _cache = null;

/* ── Paginated listings ─────────────────────────────────────── */

/**
 * Call /api/resales/listings-paged. Returns { listings, nextCursor, count }.
 *
 * The backend filters by exact city only; callers must resolve free-text
 * queries to a city via resolveCityFromQuery() first.
 */
async function fetchListings(opts) {
  opts = opts || {};
  var params = new URLSearchParams();
  if (opts.city)         params.set('city', opts.city);
  if (opts.propertyType) params.set('propertyType', opts.propertyType);
  if (opts.minPrice)     params.set('minPrice', String(opts.minPrice));
  if (opts.maxPrice)     params.set('maxPrice', String(opts.maxPrice));
  if (opts.minBedrooms)  params.set('minBedrooms', String(opts.minBedrooms));
  if (opts.features && opts.features.length)
    params.set('features', opts.features.join(','));
  if (opts.cursor)       params.set('cursor', opts.cursor);
  if (opts.limit)        params.set('limit', String(opts.limit));
  if (opts.sort)         params.set('sort', opts.sort);
  if (opts.lang)         params.set('lang', opts.lang);

  var url = RESALES_PAGED_URL + (params.toString() ? '?' + params.toString() : '');
  var res = await fetch(url);
  if (!res.ok) {
    var text = '';
    try { text = await res.text(); } catch (_) {}
    throw new Error('listings-paged ' + res.status + ' ' + text.slice(0, 200));
  }
  var data = await res.json();
  if (data.error) throw new Error('listings-paged: ' + data.error);
  return data;
}

/* ── Location index for autocomplete ────────────────────────── */

let _locationIndexPromise = null;

async function getLocationIndex() {
  if (window._locationIndex) return window._locationIndex;
  if (_locationIndexPromise) return _locationIndexPromise;
  _locationIndexPromise = (async function() {
    var res = await fetch(RESALES_LOCATIONS_URL);
    if (!res.ok) throw new Error('locations ' + res.status);
    var data = await res.json();
    window._locationIndex = data;
    var byNorm = {};
    (data.cities || []).forEach(function(c) { byNorm[c.normName] = c.name; });
    window._cityByNormName = byNorm;
    return data;
  })();
  try {
    return await _locationIndexPromise;
  } catch (err) {
    _locationIndexPromise = null;
    throw err;
  }
}

function resolveCityFromQuery(query) {
  if (!query || !window._cityByNormName) return null;
  var nq = norm(query.trim());
  return window._cityByNormName[nq] || null;
}

/* ── Legacy flat-list path (used by index / favoritos / dashboards / offers / visits) ── */

async function getAllProperties() {
  if (_cache) return _cache;
  var res = await fetch(RESALES_API_URL);
  var data = await res.json();
  if (data.error) throw new Error('Listings API error: ' + data.error);
  console.log('[properties.js] Loaded', data.length, 'properties from listings API');
  _cache = data;
  return _cache;
}

/* ── Public API ──────────────────────────────────────────────── */

async function getPropertyById(id) {
  if (!id) return null;
  try {
    var res = await fetch(RESALES_API_BASE + '/property/' + encodeURIComponent(id));
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[properties.js] Per-property fetch failed, falling back to listings cache:', err.message);
  }
  var props = await getAllProperties();
  return props.find(function(p) { return p.id === id; }) || null;
}

function formatPrice(price) {
  return '€' + Number(price).toLocaleString('es-ES');
}

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/* ── Suggestions (backed by /api/resales/locations) ─────────── */

function _sLang() {
  try {
    return (typeof localStorage !== 'undefined' &&
            localStorage.getItem('preos-lang')) || 'es';
  } catch (_) { return 'es'; }
}

function _propsLabel(n) {
  if (_sLang() === 'en') return n === 1 ? '1 property' : n + ' properties';
  return n === 1 ? '1 propiedad' : n + ' propiedades';
}

function _typeLabel(kind) {
  var es = { province: 'Provincia', city: 'Ciudad', area: 'Zona', neighbourhood: 'Barrio' };
  var en = { province: 'Province',  city: 'City',   area: 'Area', neighbourhood: 'Neighbourhood' };
  return (_sLang() === 'en' ? en : es)[kind] || '';
}

async function getSuggestions(query) {
  if (!query || query.trim().length < 1) return [];

  var idx;
  try {
    idx = await getLocationIndex();
  } catch (err) {
    console.warn('[properties.js] locations index failed:', err.message);
    return [{ type: 'all', text: query.trim(), secondary: '', searchValue: query.trim() }];
  }

  var q = norm(query.trim());

  function pickPrefix(entries, limit) {
    var out = [];
    for (var i = 0; i < entries.length && out.length < limit; i++) {
      if (entries[i].normName.indexOf(q) === 0) out.push(entries[i]);
    }
    return out;
  }
  function pickContains(entries, limit, exclude) {
    var out = [];
    var seen = {};
    for (var i = 0; i < exclude.length; i++) seen[exclude[i].name] = true;
    for (var j = 0; j < entries.length && out.length < limit; j++) {
      if (seen[entries[j].name]) continue;
      if (entries[j].normName.indexOf(q) > -1) out.push(entries[j]);
    }
    return out;
  }

  var provinceMatches = pickPrefix(idx.provinces || [], 3);
  var cityMatches     = pickPrefix(idx.cities    || [], 5);
  var areaPrefix      = pickPrefix(idx.areas     || [], 5);
  var areaContains    = pickContains(idx.areas   || [], 5 - areaPrefix.length, areaPrefix);
  var areaMatches     = areaPrefix.concat(areaContains);
  var nbhdMatches     = pickPrefix(idx.neighbourhoods || [], 5);

  var suggestions = [];
  provinceMatches.forEach(function(e) {
    suggestions.push({
      type: 'province', text: e.name,
      secondary: _typeLabel('province') + ' · ' + _propsLabel(e.count),
      searchValue: e.name + ' provincia'
    });
  });
  cityMatches.forEach(function(e) {
    suggestions.push({
      type: 'city', text: e.name,
      secondary: _typeLabel('city') + ' · ' + _propsLabel(e.count),
      searchValue: e.name
    });
  });
  areaMatches.forEach(function(e) {
    suggestions.push({
      type: 'area', text: e.name,
      secondary: _typeLabel('area') + ' · ' + _propsLabel(e.count),
      searchValue: e.name
    });
  });
  nbhdMatches.forEach(function(e) {
    suggestions.push({
      type: 'neighbourhood', text: e.name,
      secondary: _typeLabel('neighbourhood') + ' · ' + _propsLabel(e.count),
      searchValue: e.name
    });
  });

  var capped = suggestions.slice(0, 7);
  capped.push({
    type: 'all', text: query.trim(),
    secondary: '', searchValue: query.trim()
  });
  return capped;
}
