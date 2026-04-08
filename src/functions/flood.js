/**
 * flood.js — SNCZI flood zone check (Azure Functions v4)
 *
 * Fetches WMS tiles for T10, T100, T500 return periods from
 * the Spanish SNCZI service, reads pixel colours with built-in
 * Node.js zlib (no external dependencies), and returns whether
 * the coordinate falls in each flood zone.
 *
 * GET /api/flood?lat={lat}&lng={lng}
 * Returns: { t10: bool|null, t100: bool|null, t500: bool|null }
 */

const { app } = require('@azure/functions');
const zlib    = require('zlib');

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

    async function checkPeriod(key) {
      try {
        const { url, layer } = periods[key];
        const tileUrl = `${url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
          `&LAYERS=${encodeURIComponent(layer)}&STYLES=&SRS=EPSG:4326` +
          `&BBOX=${bbox}&WIDTH=${W}&HEIGHT=${H}` +
          `&FORMAT=image/png&TRANSPARENT=FALSE`;

        const res = await fetch(tileUrl, {
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());

        // Quick check: scan raw PNG bytes for the flood colour
        // The flood zone orange (R=255,G=191,B=0) appears as bytes
        // 0xFF 0xBF 0x00 in the raw pixel data within the IDAT chunks.
        // After zlib decompression, each scanline starts with a filter
        // byte, followed by raw RGBA or RGB pixels.
        //
        // Strategy: find and decompress IDAT chunks, then scan for
        // the flood orange colour sequence.

        // Parse PNG chunks
        let offset = 8; // skip PNG signature
        const idatBuffers = [];
        let colorType = 2; // default RGB
        let width = W, height = H;

        while (offset < buf.length - 8) {
          const chunkLen  = buf.readUInt32BE(offset);
          const chunkType = buf.toString('ascii', offset + 4, offset + 8);
          const chunkData = buf.slice(offset + 8, offset + 8 + chunkLen);

          if (chunkType === 'IHDR') {
            width     = chunkData.readUInt32BE(0);
            height    = chunkData.readUInt32BE(4);
            colorType = chunkData[9];
          }
          if (chunkType === 'IDAT') {
            idatBuffers.push(chunkData);
          }
          if (chunkType === 'IEND') break;
          offset += 4 + 4 + chunkLen + 4; // len + type + data + crc
        }

        if (!idatBuffers.length) return null;

        // Decompress all IDAT chunks together
        const compressed   = Buffer.concat(idatBuffers);
        const decompressed = await new Promise((resolve, reject) => {
          zlib.inflate(compressed, (err, result) => {
            if (err) reject(err); else resolve(result);
          });
        });

        // Each scanline = 1 filter byte + width * bytesPerPixel bytes
        // colorType 2 = RGB (3 bytes), colorType 6 = RGBA (4 bytes)
        const bytesPerPixel = (colorType === 6) ? 4 : 3;
        const bytesPerRow   = 1 + width * bytesPerPixel;

        for (let row = 0; row < height; row++) {
          const rowStart = row * bytesPerRow + 1; // +1 to skip filter byte
          for (let col = 0; col < width; col++) {
            const px = rowStart + col * bytesPerPixel;
            const r  = decompressed[px];
            const g  = decompressed[px + 1];
            const b  = decompressed[px + 2];
            // Flood orange: R>200, G 80-220, B<50
            if (r > 200 && g > 80 && g < 220 && b < 50) {
              context.log(`[flood:${key}] FLOOD at row=${row} col=${col} R=${r}G=${g}B=${b}`);
              return true;
            }
          }
        }
        context.log(`[flood:${key}] clean — no flood pixels in ${width}x${height}`);
        return false;

      } catch(e) {
        context.log(`[flood:${key}] error: ${e.message}`);
        return null;
      }
    }

    const [t10, t100, t500] = await Promise.all([
      checkPeriod('t10'),
      checkPeriod('t100'),
      checkPeriod('t500')
    ]);

    context.log(`[flood] (${lat},${lng}) t10:${t10} t100:${t100} t500:${t500}`);

    return {
      status: 200,
      headers: CORS,
      body: JSON.stringify({ t10, t100, t500 })
    };
  }
});
