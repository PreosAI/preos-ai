/**
 * properties.js — Property data access layer
 *
 * Endpoints:
 *   /api/resales/listings-paged   — server-side filter + cursor pagination (NEW, used by buscar.html)
 *   /api/resales/locations        — aggregated city/area/etc. index for autocomplete
 *   /api/resales/property/<ref>   — single-listing detail
 *   /api/resales/listings         — legacy full dump, still used by index/favoritos/dashboard
 *                                   pages until those are migrated in Section C.
 */

const RESALES_API_BASE      = 'https://preos-resales-proxy.azurewebsites.net/api/resales';
const RESALES_API_URL       = RESALES_API_BASE + '/listings';
const RESALES_PAGED_URL     = RESALES_API_BASE + '/listings-paged';
const RESALES_LOCATIONS_URL = RESALES_API_BASE + '/locations';
const PROPERTIES_JSON_URL   = 'data/properties.json';

let _cache       = null;
let _cacheSource = null;

/* ── Field mapper: Resales API → normalized schema (legacy /listings path) ─── */

function mapResalesFeatures(categories) {
  if (!categories || !Array.isArray(categories)) return [];
  var features = [];
  var map = {
    'Pool': 'pool', 'Garden': 'garden',
    'Parking': 'garage', 'Garage': 'garage',
    'Air Conditioning': 'air_conditioning',
    'Elevator': 'elevator', 'Lift': 'elevator',
    'Sea Views': 'sea_views', 'Beachfront': 'beachfront',
    'Beach': 'beachfront', 'Home Automation': 'home_automation',
    'Domotica': 'home_automation', 'Terrace': 'terrace'
  };
  for (var i = 0; i < categories.length; i++) {
    var cat  = categories[i];
    var type = cat.Type  || cat.Name  || '';
    var vals = cat.Value || cat.Values || [];
    var m = map[type];
    if (m && features.indexOf(m) === -1) features.push(m);
    if (Array.isArray(vals)) {
      for (var j = 0; j < vals.length; j++) {
        var vm = map[vals[j]];
        if (vm && features.indexOf(vm) === -1) features.push(vm);
      }
    }
  }
  return features;
}

function normalizeType(type, sub) {
  var t = ((type || '') + ' ' + (sub || '')).toLowerCase();
  if (t.indexOf('apartment') > -1 || t.indexOf('flat') > -1 ||
      t.indexOf('studio') > -1) return 'Apartamento';
  if (t.indexOf('villa') > -1)     return 'Villa';
  if (t.indexOf('townhouse') > -1 || t.indexOf('semi') > -1) return 'Adosado';
  if (t.indexOf('penthouse') > -1) return 'Ático';
  if (t.indexOf('plot') > -1 || t.indexOf('land') > -1) return 'Solar';
  if (t.indexOf('commercial') > -1) return 'Local';
  if (t.indexOf('house') > -1 || t.indexOf('chalet') > -1) return 'Villa';
  return type || 'Propiedad';
}

function buildTitle(p, type, sub, lang) {
  var beds = parseInt(p.Bedrooms || 0);
  var loc  = p.Location || p.Area || '';
  var t    = normalizeType(type, sub);
  if (lang === 'en') {
    return (beds > 0 ? beds + '-bed ' : '') + t + (loc ? ' in ' + loc : '');
  }
  return (beds > 0 ? beds + ' hab. ' : '') + t + (loc ? ' en ' + loc : '');
}

function mapResalesProperty(p, index) {
  var ref  = p.Reference || ('prop-' + String(index + 1).padStart(3, '0'));
  var type = (p.PropertyType && p.PropertyType.Type) || p.Type || '';
  var sub  = (p.PropertyType && p.PropertyType.Subtype1) || '';
  var cats = (p.PropertyFeatures && p.PropertyFeatures.Category) || [];
  var lat  = parseFloat(p.Latitude  || p.lat  || 0) || null;
  var lng  = parseFloat(p.Longitude || p.lng  || 0) || null;

  var images = [];
  if (p.Pictures && Array.isArray(p.Pictures)) {
    for (var i = 0; i < p.Pictures.length; i++) {
      if (p.Pictures[i].PictureURL) images.push(p.Pictures[i].PictureURL);
    }
  } else if (p.MainImage) {
    images.push(p.MainImage);
  }

  var desc = '', descEn = '';
  if (p.Description && typeof p.Description === 'object') {
    desc   = p.Description.es || p.Description.en || '';
    descEn = p.Description.en || '';
  } else {
    desc = p.Description || '';
  }

  var statusRaw = (p.Status && p.Status.system) || p.Status || 'Available';
  var status    = statusRaw === 'Available' ? null :
                  statusRaw.toLowerCase().replace(/\s+/g, '_');
  var obraNew   = type.toLowerCase().indexOf('new') > -1 ||
                  !!(p.PropertyType && p.PropertyType.TypeId &&
                     p.PropertyType.TypeId.charAt(0) === '5');

  return {
    id:              ref,
    title:           buildTitle(p, type, sub, 'es'),
    title_en:        buildTitle(p, type, sub, 'en'),
    price:           parseInt(p.Price || p.OriginalPrice || 0),
    bedrooms:        parseInt(p.Bedrooms  || 0),
    bathrooms:       parseInt(p.Bathrooms || 0),
    size_m2:         parseInt(p.Built     || 0) || null,
    int_floor_space: parseInt(p.int_floor_space || 0) || null,
    plot_m2:         parseInt(p.GardenPlot || 0) || null,
    terrace_m2:      parseInt(p.Terrace    || 0) || null,
    location:        [p.SubLocation, p.Location, p.Area].filter(Boolean).join(', '),
    city:            p.Location    || '',
    area:            p.Area        || '',
    neighbourhood:   p.SubLocation || '',
    province:        p.Province    || 'Málaga',
    lat:             lat,
    lng:             lng,
    type:            normalizeType(type, sub),
    subtype:         sub,
    status:          status,
    obra_nueva:      obraNew,
    has_3d_tour:     !!(p.VirtualTour || p.virtualTour || p.VideoTour),
    images:          images,
    description:     desc,
    description_en:  descEn,
    features:        mapResalesFeatures(cats),
    energy_rating:   p.EnergyRated || p.CO2Rated || null,
    year_built:      parseInt(p.YearBuilt || 0) || null,
    agent:           p.AgencyName || '',
    agency_ref:      p.AgencyRef  || '',
    listed_date:     p.LastUpdate || null,
    resales_ref:     p.Reference  || ref
  };
}

/* ── Paginated listings (Section B) ──────────────────────────── */

/**
 * Call /api/resales/listings-paged with non-empty filters.
 * Returns { listings, nextCursor, count }.
 *
 * `query` is intentionally NOT a parameter — the backend filters by
 * exact city only. The caller resolves a free-text query to a city
 * via resolveCityFromQuery() before calling this.
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

/* ── Location index for autocomplete (Section B) ────────────── */

let _locationIndexPromise = null;

async function getLocationIndex() {
  if (window._locationIndex) return window._locationIndex;
  if (_locationIndexPromise) return _locationIndexPromise;
  _locationIndexPromise = (async function() {
    var res = await fetch(RESALES_LOCATIONS_URL);
    if (!res.ok) throw new Error('locations ' + res.status);
    var data = await res.json();
    window._locationIndex = data;
    // Pre-build normName → canonical name lookup for cities — used to map a
    // typed query into the `city` filter for /listings-paged.
    var byNorm = {};
    (data.cities || []).forEach(function(c) { byNorm[c.normName] = c.name; });
    window._cityByNormName = byNorm;
    return data;
  })();
  try {
    return await _locationIndexPromise;
  } catch (err) {
    _locationIndexPromise = null; // allow retry
    throw err;
  }
}

function resolveCityFromQuery(query) {
  if (!query || !window._cityByNormName) return null;
  var nq = norm(query.trim());
  return window._cityByNormName[nq] || null;
}

/* ── Data loading (legacy /listings path — used by index/favs/dashboard) ── */

async function fetchFromAPI() {
    var res = await fetch(RESALES_API_URL);
    var data = await res.json();
    if (data.error) {
        throw new Error('Listings API error: ' + data.error);
    }
    console.log('[properties.js] Loaded', data.length, 'properties from Firestore API');
    return data;
}

async function fetchFromJSON() {
  var res  = await fetch(PROPERTIES_JSON_URL);
  var data = await res.json();
  console.log('[properties.js] Loaded', data.length,
    'properties from JSON (dummy data)');
  return data;
}

async function getAllProperties() {
  if (_cache) return _cache;
  if (RESALES_API_URL) {
    try {
      _cache = await fetchFromAPI();
      _cacheSource = 'api';
      return _cache;
    } catch (err) {
      console.warn('[properties.js] API failed, falling back to JSON:',
        err.message);
    }
  }
  _cache = await fetchFromJSON();
  _cacheSource = 'json';
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

function scoreProperty(p, query) {
  var q = norm(query);
  if (!q) return 0;
  var cleanQ   = q.replace(/\s*provincia\s*$/, '').trim();
  var province = norm(p.province || '');
  var city     = norm(p.city     || '');
  var area     = norm(p.area     || '');
  var nbhd     = norm(p.neighbourhood || '');
  var title    = norm(p.title    || '');
  var loc      = norm(p.location || '');
  if (q.indexOf('provincia') > -1 && province === cleanQ) return 85;
  if (city  === cleanQ) return 100;
  if (area  === cleanQ) return 95;
  if (nbhd  === cleanQ && nbhd !== city) return 80;
  if (city.indexOf(cleanQ)  === 0) return 60;
  if (area.indexOf(cleanQ)  === 0) return 55;
  if (nbhd.indexOf(cleanQ)  === 0) return 50;
  if (area.indexOf(cleanQ)  >  -1) return 40;
  if (title.indexOf(cleanQ) >  -1) return 35;
  if (loc.indexOf(cleanQ)   >  -1) return 20;
  return 0;
}

// Legacy in-memory search — kept so other pages (favoritos, dashboard, etc.)
// keep working until Section C migrates them. Not used by buscar.html anymore.
async function searchProperties(filters) {
  filters = filters || {};
  var props        = await getAllProperties();
  var query        = filters.query;
  var type         = filters.type;
  var minPrice     = filters.minPrice;
  var maxPrice     = filters.maxPrice;
  var minBedrooms  = filters.minBedrooms;
  var minSize      = filters.minSize;
  var maxSize      = filters.maxSize;
  var features     = filters.features;
  var status       = filters.status;
  var bathrooms    = filters.bathrooms;

  var results = props.filter(function(p) {
    if (type && type !== 'todos' &&
        norm(p.type) !== norm(type)) return false;
    if (minPrice && p.price < minPrice) return false;
    if (maxPrice && maxPrice > 0 && p.price > maxPrice) return false;
    if (minBedrooms && minBedrooms > 0 &&
        p.bedrooms < minBedrooms) return false;
    if (bathrooms && bathrooms > 0 &&
        (p.bathrooms || 0) < bathrooms) return false;
    if (minSize && minSize > 0 && (p.size_m2 || 0) < minSize) return false;
    if (maxSize && maxSize > 0 && (p.size_m2 || 0) > maxSize) return false;
    if (status && status !== 'all') {
      if (status === 'obra_nueva' && !p.obra_nueva) return false;
      if (status === 'resale' && p.obra_nueva) return false;
    }
    if (features && features.length > 0) {
      var pf = p.features || [];
      for (var i = 0; i < features.length; i++) {
        if (pf.indexOf(features[i]) === -1) return false;
      }
    }
    return true;
  });

  if (query && query.trim()) {
    results = results
      .map(function(p) {
        return { p: p, score: scoreProperty(p, query.trim()) };
      })
      .filter(function(x) { return x.score > 0; })
      .sort(function(a, b) {
        return b.score - a.score || b.p.price - a.p.price;
      })
      .map(function(x) { return x.p; });
  } else {
    results = results.sort(function(a, b) {
      var qa = window.ListingQuality &&
               window.ListingQuality.cache[a.id];
      var qb = window.ListingQuality &&
               window.ListingQuality.cache[b.id];
      if (qa && qb) return qb.score - qa.score;
      if (qa) return -1;
      if (qb) return  1;
      return new Date(b.listed_date || 0) -
             new Date(a.listed_date || 0);
    });
  }
  return results;
}

/* ── Suggestions (now backed by /api/resales/locations) ─────── */

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
