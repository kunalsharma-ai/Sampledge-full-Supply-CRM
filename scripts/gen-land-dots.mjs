// Generates a dotted land mask for the 3D globe from Natural Earth 110m (via world-atlas, public domain).
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoContains } from 'd3-geo';
const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-110m.json', import.meta.url)));
const land = feature(topo, topo.objects.land);
const out = [];
const step = 1.2; // degrees
for (let lat = -58; lat <= 80; lat += step) {
  const lonStep = step / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  for (let lon = -180; lon < 180; lon += lonStep) {
    if (geoContains(land, [lon, lat])) out.push(+lat.toFixed(2), +lon.toFixed(2));
  }
}
writeFileSync(new URL('../src/lib/geo/land-dots.json', import.meta.url), JSON.stringify(out));
console.log('dots', out.length / 2);
