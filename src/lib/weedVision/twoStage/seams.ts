// Plants counted twice across a window seam.
//
// Each window keeps the instances whose centre falls in its own square, so a
// plant is counted once, unless its centre sits right on the seam: then both
// windows see the whole plant, each finds the centre a few pixels on its own
// side, and both keep it. On five orchard frames (2026-10-19) that was one to
// three plants per frame, 3 to 61 cm apart with near-equal areas. Such pairs
// (different windows, the same class, centres within half the larger
// diameter, at least 5 cm, areas within a factor of two) become one plant,
// the surer one kept. A large plant cut by the seam into a big and a small
// piece is left alone: the areas differ too much to call it a repeat.
import { mercatorPx, metresPerPixel } from "../mapRun";
import type { GroundPlant } from "../frames";

export const SEAM_MIN_M = 0.05;
export const SEAM_DIAMETER_SHARE = 0.5;
export const SEAM_AREA_RATIO = 2;

export function mergeSeamDuplicates(plants: GroundPlant[]): GroundPlant[] {
  const placed = plants.filter(p => p.centre);
  if (placed.length < 2) return plants;
  const lat = placed[0].centre!.lat;
  const m = metresPerPixel(lat, 23);
  const CELL = 4; // metres: larger than any merge radius that matters (plants up to 8 m across)
  const pos = new Map<GroundPlant, [number, number]>();
  const grid = new Map<string, GroundPlant[]>();
  const sorted = [...plants].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const kept: GroundPlant[] = [];
  for (const p of sorted) {
    if (!p.centre) { kept.push(p); continue; }
    const [X, Y] = mercatorPx(p.centre.lat, p.centre.lng, 23);
    const q: [number, number] = [X * m, Y * m];
    const cx = Math.floor(q[0] / CELL), cy = Math.floor(q[1] / CELL);
    let home: GroundPlant | null = null;
    for (let gx = cx - 1; gx <= cx + 1 && !home; gx++) for (let gy = cy - 1; gy <= cy + 1 && !home; gy++) {
      for (const o of grid.get(`${gx}:${gy}`) ?? []) {
        if (o.klass !== p.klass || o.seenIn.includes(p.frame)) continue;
        const a = p.areaM2 ?? 0, b = o.areaM2 ?? 0;
        if (!(a > 0 && b > 0) || Math.max(a, b) / Math.min(a, b) > SEAM_AREA_RATIO) continue;
        const r = Math.max(SEAM_MIN_M, SEAM_DIAMETER_SHARE * Math.max(p.diameterM ?? 0, o.diameterM ?? 0));
        const oq = pos.get(o)!;
        if (Math.hypot(oq[0] - q[0], oq[1] - q[1]) <= r) { home = o; break; }
      }
    }
    if (home) { home.seenIn = [...home.seenIn, p.frame]; home.duplicates += 1 + p.duplicates; continue; }
    const g = { ...p, seenIn: [...p.seenIn] };
    pos.set(g, q);
    kept.push(g);
    const k = `${cx}:${cy}`;
    const cell = grid.get(k);
    if (cell) cell.push(g); else grid.set(k, [g]);
  }
  return kept;
}
