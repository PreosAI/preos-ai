/**
 * properties.js — Property data access layer
 *
 * Data source:
 *   1. Resales Online API via Azure Function (when RESALES_API_URL is set)
 *   2. Fallback: data/properties.json (dummy data)
 *
 * ACTION REQUIRED after Azure Function is deployed:
 * Replace the empty string below with your Function URL:
 *   const RESALES_API_URL =
 *     'https://preos-functions.azurewebsites.net/api/resales';
 */

const RESALES_API_URL     = '';
const PROPERTIES_JSON_URL = 'data/properties.json';

let _cache       = null;
let _cacheSource = null;

/* ── Field mapper: Resales API → normalized schema ─────── */

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

/* ── Data loading ───────────────────────────────────────── */

async function fetchFromAPI() {
  var url  = RESALES_API_URL +
             '?fn=SearchProperties&P_PageSize=200&P_PageNo=1';
  var res  = await fetch(url);
  var data = await res.json();
  if (data.transaction && data.transaction.status === 'error') {
    throw new Error('Resales API error: ' +
      JSON.stringify(data.transaction));
  }
  var props = data.Property || [];
  console.log('[properties.js] Loaded', props.length,
    'properties from Resales API (' +
    ((data.transaction && data.transaction.mode) || 'live') + ')');
  return props.map(mapResalesProperty);
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

/* ── Public API (unchanged) ─────────────────────────────── */

async function getPropertyById(id) {
  var props = await getAllProperties();
  return props.find(function(p) { return p.id === id; }) || null;
}

function formatPrice(price) {
  return '€' + Number(price).toLocaleString('es-ES');
}

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
  var has3dTour    = filters.has3dTour;
  var status       = filters.status;
  var yearBuiltMin = filters.yearBuiltMin;
  var yearBuiltMax = filters.yearBuiltMax;
  var bathrooms    = filters.bathrooms;

  var results = props.filter(function(p) {
    if (type && type !== 'todos' &&
        p.type.toLowerCase() !== type.toLowerCase()) return false;
    if (minPrice && p.price < minPrice) return false;
    if (maxPrice && maxPrice > 0 && p.price > maxPrice) return false;
    if (minBedrooms && minBedrooms > 0 &&
        p.bedrooms < minBedrooms) return false;
    if (bathrooms && bathrooms > 0 &&
        (p.bathrooms || 0) < bathrooms) return false;
    if (minSize && minSize > 0 && (p.size_m2 || 0) < minSize) return false;
    if (maxSize && maxSize > 0 && (p.size_m2 || 0) > maxSize) return false;
    if (has3dTour && !p.has_3d_tour) return false;
    if (status && status !== 'all') {
      if (status === 'obra_nueva' && !p.obra_nueva) return false;
      if (status === 'resale' &&
          (p.obra_nueva || p.status === 'bank')) return false;
      if (status === 'bank' && p.status !== 'bank') return false;
    }
    if (yearBuiltMin && yearBuiltMin > 0 &&
        (p.year_built || 0) < yearBuiltMin) return false;
    if (yearBuiltMax && yearBuiltMax > 0 &&
        (p.year_built || 9999) > yearBuiltMax) return false;
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

async function getSuggestions(query) {
  if (!query || query.trim().length < 1) return [];
  var props         = await getAllProperties();
  var q             = norm(query.trim());
  var provinces     = new Map();
  var cities        = new Map();
  var areas         = new Map();
  var neighbourhoods = new Map();
  var titles        = [];

  for (var i = 0; i < props.length; i++) {
    var p        = props[i];
    var province = p.province      || '';
    var city     = p.city          || '';
    var area     = p.area          || '';
    var nbhd     = p.neighbourhood || '';
    var title    = p.title         || '';
    if (province && norm(province).indexOf(q) === 0)
      provinces.set(province, (provinces.get(province) || 0) + 1);
    if (city && norm(city).indexOf(q) === 0)
      cities.set(city, province);
    if (area) {
      if (norm(area).indexOf(q) === 0) areas.set(area, city);
      else if (norm(area).indexOf(q) > -1) areas.set(area, city);
    }
    if (nbhd && nbhd !== city && norm(nbhd).indexOf(q) === 0)
      neighbourhoods.set(nbhd, city);
    if (title && norm(title).indexOf(q) > -1 && titles.length < 2)
      titles.push({ text: title, id: p.id });
  }

  var suggestions = [];
  provinces.forEach(function(count, province) {
    suggestions.push({
      type: 'province', text: province,
      secondary: 'Provincia · ' + count + ' ' +
        (count === 1 ? 'propiedad' : 'propiedades'),
      searchValue: province + ' provincia'
    });
  });
  cities.forEach(function(province, city) {
    suggestions.push({
      type: 'city', text: city,
      secondary: province ? 'Ciudad · ' + province : 'Ciudad',
      searchValue: city
    });
  });
  areas.forEach(function(city, area) {
    suggestions.push({
      type: 'area', text: area,
      secondary: city ? 'Zona · ' + city : 'Zona',
      searchValue: area
    });
  });
  neighbourhoods.forEach(function(city, nbhd) {
    suggestions.push({
      type: 'neighbourhood', text: nbhd,
      secondary: city ? 'Barrio · ' + city : 'Barrio',
      searchValue: nbhd
    });
  });
  for (var j = 0; j < titles.length; j++) {
    suggestions.push({
      type: 'property', text: titles[j].text,
      secondary: 'Propiedad', id: titles[j].id,
      searchValue: titles[j].text
    });
  }
  var capped = suggestions.slice(0, 7);
  capped.push({
    type: 'all', text: query.trim(),
    secondary: '', searchValue: query.trim()
  });
  return capped;
}
