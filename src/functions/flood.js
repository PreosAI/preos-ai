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

    context.log(`[flood:${key}] fetching ${tileUrl.substring(0,80)}...`);
    const res = await fetch(tileUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = await Jimp.read(buf);

    // Debug: log first few non-white pixel values found
    const debugPixels = [];
    for (let px = 0; px < 64; px += 4) {
      for (let py = 0; py < 64; py += 4) {
        const hex = img.getPixelColor(px, py);
        const rgba = Jimp.intToRGBA(hex);
        if (rgba.r < 250 || rgba.g < 250 || rgba.b < 250) {
          debugPixels.push(`(${px},${py}):R${rgba.r}G${rgba.g}B${rgba.b}A${rgba.a}`);
          if (debugPixels.length >= 3) break;
        }
      }
      if (debugPixels.length >= 3) break;
    }
    context.log(`[flood:${key}] buf=${buf.length}b img=${img.getWidth()}x${img.getHeight()} nonWhite:${debugPixels.join(' ')}`);

    // Scan full tile at 4px intervals
    for (let px = 0; px < W; px += 4) {
      for (let py = 0; py < H; py += 4) {
        const hex = img.getPixelColor(px, py);
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

    const d    = 0.005;
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
