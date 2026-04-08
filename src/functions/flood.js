/**
 * flood.js — SNCZI flood zone check (Azure Functions v4)
 *
 * Fetches WMS tiles for T10, T100, T500 return periods from
 * the Spanish SNCZI service, reads pixel colours with jimp,
 * and returns whether the coordinate falls in each flood zone.
 *
 * GET /api/flood?lat={lat}&lng={lng}
 * Returns: { t10: bool|null, t100: bool|null, t500: bool|null }
 */

const { app } = require('@azure/functions');
const Jimp    = require('jimp');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json'
};

const periods = {
  t10:  { url: 'https://wms.mapama.gob.es/sig/agua/ZI_LaminasQ10/wms.aspx',
           layer: 'Z.I. con alta probabilidad' },
  t100: { url: 'https://wms.mapama.gob.es/sig/agua/ZI_LaminasQ100/wms.aspx',
           layer: 'Z.I. con probabilidad media u ocasional' },
  t500: { url: 'https://wms.mapama.gob.es/sig/agua/ZI_LaminasQ500/wms.aspx',
           layer: 'Z.I. con baja probabilidad o excepcional' }
};

// Flood zone colour: R=255 G=191 B=0 (golden orange)
// White = R=255 G=255 B=255 = not in flood zone
function isFloodPixel(r, g, b) {
  return r > 200 && g > 80 && g < 220 && b < 50;
}

async function checkPeriod(key, bbox, W, H, context) {
  try {
    const { url, layer } = periods[key];
    const tileUrl = `${url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
      `&LAYERS=${encodeURIComponent(layer)}&STYLES=&SRS=EPSG:4326` +
      `&BBOX=${bbox}&WIDTH=${W}&HEIGHT=${H}` +
      `&FORMAT=image/png&TRANSPARENT=FALSE`;

    const res = await fetch(tileUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = await Jimp.read(buf);

    // Sample a 5x5 grid across the centre of the tile
    for (let px = W*0.3; px <= W*0.7; px += W*0.1) {
      for (let py = H*0.3; py <= H*0.7; py += H*0.1) {
        const hex = img.getPixelColor(Math.round(px), Math.round(py));
        const { r, g, b } = Jimp.intToRGBA(hex);
        if (isFloodPixel(r, g, b)) return true;
      }
    }
    return false;
  } catch(e) {
    context.log(`flood check ${key} error:`, e.message);
    return null;
  }
}

app.http('flood', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: CORS };
    }

    const lat = parseFloat(request.query.get('lat'));
    const lng = parseFloat(request.query.get('lng'));

    if (isNaN(lat) || isNaN(lng)) {
      return { status: 400, headers: CORS, body: 'lat and lng required' };
    }

    const d    = 0.002;
    const bbox = `${lng-d},${lat-d},${lng+d},${lat+d}`;
    const W    = 256, H = 256;

    const [t10, t100, t500] = await Promise.all([
      checkPeriod('t10',  bbox, W, H, context),
      checkPeriod('t100', bbox, W, H, context),
      checkPeriod('t500', bbox, W, H, context)
    ]);

    context.log(`[flood] (${lat},${lng}) t10:${t10} t100:${t100} t500:${t500}`);

    return {
      status: 200,
      headers: CORS,
      body: JSON.stringify({ t10, t100, t500 })
    };
  }
});
