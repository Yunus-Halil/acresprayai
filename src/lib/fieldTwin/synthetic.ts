// A synthetic Field Twin of any size, for benchmarks only: deterministic (seeded), the same bundle format as a real
// twin, with weeds in hot spots and a thin scatter, rows and trees on a planting lattice, and overlapping photo
// footprints (some ground seen once, most twice). Nothing here is a measurement; the generator exists so the
// viewer can be timed at 1,000 to 1,000,000 observations. Never used for a real field.
import { FIELD_TWIN_FORMAT, type LatLngPair, type TwinBundle, type TwinWeed } from "./types";

/** mulberry32: a small seeded generator, enough for a layout. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type SyntheticOptions = {
  weeds: number;
  seed?: number;
  /** Weeds per square metre of field, which sets the field's size. */
  density?: number;
  /** Trees are capped: a million-weed field would otherwise carry 200,000 crowns, which no bundle holds today. */
  maxTrees?: number;
  /** Outline points per weed; 0 draws every weed as its equal-area circle (the renderer's fallback). */
  ringPoints?: number;
};

export function syntheticTwin(opts: SyntheticOptions): TwinBundle {
  const n = opts.weeds, rnd = seeded(opts.seed ?? 7), density = opts.density ?? 0.3, maxTrees = opts.maxTrees ?? 20_000;
  const ringPoints = opts.ringPoints ?? (n > 200_000 ? 0 : 6);
  const LAT = 33.88, LNG = -5.42, mLat = 111_320, mLng = 111_320 * Math.cos((LAT * Math.PI) / 180);
  const at = (e: number, no: number): LatLngPair => [+(LAT + no / mLat).toFixed(8), +(LNG + e / mLng).toFixed(8)];
  // A field twice as long as wide, sized by density.
  const areaM2 = Math.max(10_000, n / density), width = Math.sqrt(areaM2 / 2), length = 2 * width;
  const rowSpacing = 5, plantSpacing = 3;
  // Rows run east; the block is the lattice.
  const nRows = Math.floor(width / rowSpacing), perRow = Math.floor(length / plantSpacing);
  const rows: TwinBundle["rows"] = [], trees: TwinBundle["trees"] = [];
  let tid = 1;
  for (let r = 0; r < nRows; r++) {
    const across = (r + 0.5) * rowSpacing;
    rows.push({ id: r + 1, kept: true, reason: null, line: [at(0, across), at(perRow * plantSpacing, across)], trees: perRow, inferred: 0, photos: 2, lengthM: perRow * plantSpacing, straightnessSdM: 0.1 });
    if (trees.length < maxTrees) for (let i = 0; i < perRow && trees.length < maxTrees; i++) {
      const e = (i + 0.5) * plantSpacing, [lat, lng] = at(e, across);
      trees.push({ id: tid++, lat, lng, crownRadiusM: 0.9 + 0.4 * rnd(), heightM: 1.5, seenBy: 2, coveredBy: 2, viewSpreadM: 0.05, sizeCv: 0.08, rowId: r + 1, evidence: [] });
    }
  }
  // Photographs: 60 x 40 m footprints with 50 % overlap along the flight line, none across (so the strips' edges
  // are ground seen once, the overlaps ground seen twice), plus a margin of ground no photograph saw.
  const footprints: TwinBundle["footprints"] = [];
  for (let y = -5; y < width + 5; y += 40) for (let x = -5; x < length + 5; x += 30) footprints.push({ photo: `syn_${footprints.length}.JPG`, ring: [at(x, y), at(x + 60, y), at(x + 60, y + 40), at(x, y + 40)] });
  // Weeds: 60 % in hot spots (count scaled with the field), the rest scattered. Areas lognormal around 0.03 m2.
  const spots = Math.max(3, Math.round(areaM2 / 4000));
  const centres = Array.from({ length: spots }, () => ({ e: rnd() * length, n: rnd() * width, s: 4 + 12 * rnd(), w: 0.3 + rnd() }));
  const wsum = centres.reduce((s, c) => s + c.w, 0);
  const gauss = () => { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const weeds: TwinWeed[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let e: number, no: number;
    if (rnd() < 0.6) {
      let pick = rnd() * wsum, c = centres[0];
      for (const cc of centres) { pick -= cc.w; if (pick <= 0) { c = cc; break; } }
      e = c.e + gauss() * c.s; no = c.n + gauss() * c.s;
    } else { e = rnd() * length; no = rnd() * width; }
    e = Math.min(length, Math.max(0, e)); no = Math.min(width, Math.max(0, no));
    const areaM2w = Math.min(4, 0.03 * Math.exp(0.9 * gauss())), d = 2 * Math.sqrt(areaM2w / Math.PI);
    const u = rnd(), status: TwinWeed["status"] = u < 0.7 ? "verified" : u < 0.95 ? "single view" : "on a tree";
    const across = no % rowSpacing, onRow = Math.abs(across - rowSpacing / 2) < 0.8;
    const [lat, lng] = at(e, no);
    const ring: LatLngPair[] = [];
    for (let k = 0; k < ringPoints; k++) { const a = (2 * Math.PI * k) / ringPoints, rr = (d / 2) * (0.8 + 0.4 * rnd()); ring.push(at(e + rr * Math.cos(a), no + rr * Math.sin(a))); }
    const seenBy = status === "single view" ? 1 : 2 + Math.floor(rnd() * 3);
    weeds[i] = { id: i + 1, lat, lng, status, rowStatus: onRow ? "on a row" : "between rows", diameterM: +d.toFixed(3), areaM2: +areaM2w.toFixed(4), spanM: null, heightM: null, seenBy, coveredBy: seenBy + (rnd() < 0.5 ? 1 : 0), viewSpreadM: +(0.02 + 0.08 * rnd()).toFixed(3), sizeCv: +(0.05 + 0.5 * rnd() * rnd()).toFixed(2), score: +(0.4 + 0.55 * rnd()).toFixed(2), treeId: null, ring, evidence: [] };
  }
  return {
    format: FIELD_TWIN_FORMAT, id: `synthetic-${n}`, name: `Synthetic field, ${n.toLocaleString()} observations`, builtAt: "synthetic",
    source: { photographs: footprints.length, camera: "none (synthetic)", capturedAt: null, groundPixelCm: 1, method: "synthetic benchmark field", weedModel: "none", treeModel: "none" },
    origin: { lat: LAT, lng: LNG }, bounds: [at(-10, -10), at(length + 10, width + 10)], field: { rowDirectionDeg: 0, rowSpacingM: rowSpacing, plantSpacingM: plantSpacing },
    footprints, rows, trees, inferredTrees: [], weeds, vegetation: [], atlases: [], stats: { synthetic: true, areaM2, spots },
  };
}
