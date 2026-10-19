// Run from the repo root: npx vite-node research/weed-vision-lab/scripts/two_stage_app_cost.ts
// App-side cost of the map run's per-plant steps at field scale (two-stage investigation, 2026-10-19).
// Synthetic instances shaped like the service's answer; timings are Node (V8), single thread.
const SRC = new URL("../../../src/lib", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const { groundMapResult, planMapChunks, metresPerPixel, latLngOfPx, mercatorPx } = await import(`${SRC}/weedVision/mapRun.ts`);
const { buildHotspots } = await import(`${SRC}/weedVision/hotspots.ts`);
const { pointInRing } = await import(`${SRC}/geo.ts`);
const { templateOf, snapShift } = await import(`${SRC}/weedVision/snap.ts`);

const lat0 = 38.03, lng0 = -78.48, z = 23;
const mpp = metresPerPixel(lat0, z);
const now = () => performance.now();
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const r = rng(1);

function instance(id: number, cx: number, cy: number, rad: number, klass: "weed" | "crop") {
  const poly: [number, number][] = [];
  const n = 60; // the service's polygons are simplified at 0.8 px; 60 vertices is typical for a mid-sized plant
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const rr = rad * (0.8 + 0.4 * r()); poly.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  return { id, centroid_px: [cx, cy], bbox_px: [cx - rad, cy - rad, cx + rad, cy + rad], area_px: Math.PI * rad * rad, max_span_px: 2 * rad, span_endpoints_px: [[0, 0], [1, 1]],
    perpendicular_span_px: rad, obb: { length_px: 2 * rad, width_px: rad, angle_deg: 0 }, equivalent_diameter_px: 2 * rad, solidity: 0.9, pieces: 1, touches_border: false, tiny: rad < 3,
    score: 0.5 + 0.5 * r(), score_kind: "detector_confidence", polygons_px: [poly], flags: [], class: klass, fused_from_tiles: 1 };
}

// A 1 ha square field, chunks as the app plans them; instances per chunk scaled from DJI_0301 (1311 instances in ~1950 m2 at threshold 0.5)
const [X0, Y0] = mercatorPx(lat0, lng0, z);
const side = 100 / mpp;
const ring = [latLngOfPx(X0, Y0, z), latLngOfPx(X0 + side, Y0, z), latLngOfPx(X0 + side, Y0 + side, z), latLngOfPx(X0, Y0 + side, z)];
// a boundary with 400 vertices, as a traced field would have
const ring400 = Array.from({ length: 400 }, (_, k) => { const t = k / 400 * 4; const e = Math.floor(t), f = t - e; const a = ring[e % 4], b = ring[(e + 1) % 4]; return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f }; });
const chunks = planMapChunks([ring400], z);
const perM2 = 1311 / 1950;
const out: Record<string, unknown> = { metres_per_pixel_z23: mpp, chunks_per_ha: chunks.length };

for (const scaleHa of [1, 10]) {
  const nPerChunk = Math.round(perM2 * (1536 * mpp) ** 2);
  let tGround = 0, bytes = 0;
  const all: any[] = [];
  const reps = scaleHa === 1 ? chunks.length : chunks.length * 10;
  for (let c = 0; c < reps; c++) {
    const chunk = chunks[c % chunks.length];
    const upscale = 1.5;
    const W = (1536 + 192) * upscale;
    const inst = Array.from({ length: nPerChunk }, (_, i) => instance(i + 1, r() * W, r() * W, 2 + r() * 20, r() < 0.8 ? "weed" : "crop"));
    const result = { instances: inst.filter(i => i.class === "weed"), crop_instances: inst.filter(i => i.class === "crop") } as any;
    const t0 = now();
    const dets = groundMapResult({ chunk, result, upscale, rows: null, lat: lat0 });
    tGround += now() - t0;
    bytes += JSON.stringify(dets).length;
    for (const d of dets) all.push({ ...d, seenIn: [d.frame], duplicates: 0 });
  }
  let t0 = now();
  let kept = 0;
  for (const p of all) if (p.centre && pointInRing(p.centre, ring400)) kept++;
  const tWithin = now() - t0;
  t0 = now();
  const hs = buildHotspots({ lat: lat0, lng: lng0, altM: 0 }, 0, all);
  const tHot = now() - t0;
  t0 = now();
  const json = JSON.stringify(all);
  const tStringify = now() - t0;
  out[`${scaleHa}ha`] = {
    plants: all.length, ground_ms: Math.round(tGround), within_boundary_ms: Math.round(tWithin), hotspots_ms: Math.round(tHot), hotspot_areas: hs.hotspots.length,
    persisted_json_mb: +(bytes / 1e6).toFixed(1), in_memory_json_mb: +(json.length / 1e6).toFixed(1), stringify_ms: Math.round(tStringify),
    publish_recompute_ms_each: Math.round(tWithin + tHot),
  };
}

// One outline snap: template + search, for a map outline (12 cm radius) at 1.5 cm/px
{
  const maxShiftPx = Math.ceil(0.12 / 0.015);
  const rad = 10, pad = maxShiftPx + 6, w = 2 * (rad + pad), h = w;
  const poly: [number, number][] = Array.from({ length: 40 }, (_, k) => [w / 2 + rad * Math.cos(k / 40 * 6.283), h / 2 + rad * Math.sin(k / 40 * 6.283)]);
  const green = new Uint8Array(w * h).map(() => (r() < 0.3 ? 1 : 0));
  const reps = 2000;
  const t0 = now();
  for (let i = 0; i < reps; i++) { const t = templateOf(poly, w, h, 3); snapShift(green, w, h, t, maxShiftPx); }
  out.snap_compute_ms_per_outline = +((now() - t0) / reps).toFixed(3);
}
console.log(JSON.stringify(out, null, 1));
