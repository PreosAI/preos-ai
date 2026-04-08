/**
 * flood.js — SNCZI flood zone check (Azure Functions v4)
 *
 * Fetches WMS tiles for T10, T100, T500 return periods from
 * the Spanish SNCZI service, reads pixel colours with pngjs,
 * and returns whether the coordinate falls in each flood zone.
 *
 * GET /api/flood?lat={lat}&lng={lng}
 * Returns: { t10: bool|null, t100: bool|null, t500: bool|null }
 */

const { app } = require('@azure/functions');
const { PNG } = require('pngjs');

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

    // Parse PNG synchronously using pngjs
    const png = PNG.sync.read(buf);
    const { width, height, data } = png;

    // Scan all pixels for flood zone colour
    // Flood: R>200, G>80 && G<220, B<50
    // White: R=255, G=255, B=255
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        if (r > 200 && g > 80 && g < 220 && b < 50) {
          context.log(`[flood:${key}] flood pixel at (${x},${y}) R=${r}G=${g}B=${b}`);
          return true;
        }
      }
    }
    context.log(`[flood:${key}] no flood pixels in ${width}x${height} tile`);
    return false;
  } catch(e) {
    context.log(`[flood:${key}] error: ${e.message}`);
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
