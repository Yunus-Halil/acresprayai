// Corn in a Field Twin build: the plants first, then the rows through them (plantsFirst.ts), from the reads the corn
// stage already made. No photograph is decoded again: each read carries the plants its photograph located.
//
// What a build keeps from it:
//   plants   one dot per plant two or more photographs located, with what it is drawn as (certain / probable on a row,
//            seen on no row, between two rows: not the crop) and how many photographs hold it
//   rows     each row cut into stretches running exactly from a plant to a plant: "corn" where plants were seen along
//            it, "unconfirmed" where the row probably continues but no plant was confirmed (never across a headland)
// The corn stage's own rows (cornField) stay the fallback: a flight whose plants make no certain row keeps them.
import { type GeorefFrame, pixelToGround } from "@/lib/directGeoref/projection";
import { ROW_POINTS } from "@/lib/rowCrop/greenPoints";
import { type LatLngAlt, fromEnu, toEnu } from "@/lib/sourceFrames/odm";
import type { CornFieldResult, CornPhotoRead, FieldGround } from "./cornField";
import { PLANTS_FIRST, type Reconstruction, SEQUENCE, SETTLED } from "./plantsFirst";

export type CornStretch = {
  /** The field row it belongs to, and whether plants were seen along it. */
  row: number; confirmed: boolean;
  /** Metres east/north of the field origin, and the same in latitude/longitude. */
  lineEN: [number, number][]; line: [number, number][];
  lengthM: number; why: string;
  /** Plants located along it (0 where the row probably continues but no plant was confirmed). */
  plants: number;
};

/** A field row: its plants, how many of them most photographs over them saw, plants per metre, and how it was found. */
export type CornFieldRow = { id: number; plants: number; certain: number; perM: number; kind: "certain" | "geometry" };

export type CornPlants = {
  /** Per plant: latitude, longitude. */
  points: [number, number][];
  /** Per plant: 0 a certain plant on a row, 1 a probable one, 2 seen on no row, 3 between two rows (not the crop);
   * found along a row at the lower bar (2026-11-16, probable): 4 by two or more photographs, 5 by one photograph's sharp view;
   * 6 a plant the second look added (L7, LAYERS.secondLook, development only);
   * 7 a double (SEQUENCE.doublesApart): on a row's line, refused only as closer than the too-close limit to a plant on it.
   * With doublesApart, 2 and 3 are green that is not corn (not counted). */
  shown: number[];
  /** Per plant: photographs that located it. */
  photos: number[];
  stretches: CornStretch[];
  /** The field rows the stretches belong to (`CornStretch.row`). */
  rows: CornFieldRow[];
  geometry: { spacingM: number; directionDeg: number; seedM: number | null; certainRows: number; certainDots: number };
  summary: { plants: number; certain: number; probable: number; onNoRow: number; betweenRows: number; rows: number; confirmedM: number; notConfirmedM: number;
    /** Plants found along the rows at the lower bar (shown 4 and 5), when a photograph carried candidates. */
    alongRowsTwo?: number; alongRowsOne?: number;
    /** Of the plants on rows, those there only by the loosened placement (development, `free`). */
    loosened?: number;
    /** Of the plants on rows, those the second look put there (L7, development). */
    secondLook?: number;
    /** The doubles (shown 7), with SEQUENCE.doublesApart: its presence says 2 and 3 are not counted. */
    doubles?: number };
  /** Per plant: 1 when it is on its row only by the loosened placement (development, `free`). */
  loose?: number[];
};

/** Shortest stretch kept, metres (a sliver at a row's end says nothing). */
const MIN_STRETCH_M = 0.3;

/** A flight's dots before any row is read: the stricter marks' dots first (`strict` of them), then the candidates for
 * the rows with their tier (plantsFirst.ts rowCandidates); how many photographs looked at each; and the first reading
 * of rows through the certain dots (direction, row spacing, plant spacing). */
// L3 Place (fieldTwin/layers/l3Place.ts): the dots on the ground, merged across the photographs; the options and the
// candidates' points live there too (moved 2026-11-18: no import cycle), re-exported here.
export { type CornPlantsOptions, type PlacedDots, candidatePoints, placeDots } from "./layers/l3Place";
import { type CornPlantsOptions, type PlacedDots, placeDots } from "./layers/l3Place";
import { reconstruct } from "./layers/chain";
import { LAYERS } from "./layers/options";

/** Steps 4 on: the rows through the certain dots, and every other dot against them (plantsFirst.ts reconstruct). */
export function readRows(P: PlacedDots, F: CornFieldResult, opts: CornPlantsOptions = {}): Reconstruction {
  const q = opts.sequence ?? SEQUENCE;
  return reconstruct(P.all, P.covered, F.directionDeg ?? 0, F.pitchM ?? 0.76, opts.placing ?? PLANTS_FIRST, opts.free ? { ...q, free: true } : q, P.tier ? Uint8Array.from(P.tier, t => (t ? 1 : 0)) : null, P.tier, P.pre, opts.ground ? { state: opts.ground.state, dotState: P.groundState ?? null } : null, opts.layers ? { ...LAYERS, ...opts.layers } : LAYERS);
}

/** The plants and the rows through them; null when the plants make no certain row (the caller keeps cornField's rows). */
export function cornPlantsFirst(reads: CornPhotoRead[], frames: Map<string, GeorefFrame>, F: CornFieldResult, opts: CornPlantsOptions = {}): CornPlants | null {
  const P = placeDots(reads, frames, F, opts);
  return P ? cornPlantsOf(P, readRows(P, F, opts), F, opts) : null;
}

/** What a build keeps of a reading of the rows (see the header). */
export function cornPlantsOf(P: PlacedDots, rec: Reconstruction, F: CornFieldResult, opts: CornPlantsOptions = {}): CornPlants | null {
  const { all, strict, tier } = P;
  const G = rec.geometry;
  if (!G.certainRows || !rec.rows.length) return null;

  const ll = (e: number, n: number): [number, number] => { const p = fromEnu([e, n, 0], F.origin); return [Math.round(p.lat * 1e8) / 1e8, Math.round(p.lng * 1e8) / 1e8]; };
  const th = (G.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
  const stretches: CornStretch[] = [], fieldRows: CornFieldRow[] = [];
  // With corn only in runs (SEQUENCE.runReachSeeds): a row is not drawn past its last plants. A stretch with no plant
  // confirmed is kept only between two stretches drawn with plants (the plants beyond it can be too few to be drawn as
  // a stretch: the grey line then led out to nothing).
  const noGreyEnds = ((opts.sequence ?? SEQUENCE).runReachSeeds ?? 0) > 0;
  for (const r of rec.rows) {
    const certain = r.dots.filter(i => rec.certainty[i] === 0).length, first = stretches.length;
    for (const g of r.segments) {
      const lineEN = stretchLine(r.line, g.a0, g.a1, ct, st);
      if (lineEN.length < 2) continue;
      const lengthM = lineEN.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - lineEN[i][0], p[1] - lineEN[i][1]), 0);
      if (lengthM < MIN_STRETCH_M) continue;
      // Confirmed stretches share no plant (an unconfirmed one runs between their end plants and holds none).
      const plants = g.confirmed ? r.dots.filter(i => rec.a[i] >= g.a0 - 1e-9 && rec.a[i] <= g.a1 + 1e-9).length : 0;
      stretches.push({ plants,
        row: r.id, confirmed: g.confirmed, lineEN, line: lineEN.map(([e, n]) => ll(e, n)), lengthM: Math.round(lengthM * 100) / 100,
        why: g.confirmed
          ? `Plants seen along it (row ${r.id}: ${r.dots.length} plants, ${certain} seen by most photographs over them, ${r.perM.toFixed(1)} a metre${r.kind === "geometry" ? "; found in a slot the certain rows leave" : ""}).`
          : `The row probably continues here (row ${r.id}), but no plant was confirmed on this stretch.`,
      });
    }
    if (noGreyEnds) { while (stretches.length > first && !stretches[stretches.length - 1].confirmed) stretches.pop(); while (stretches.length > first && !stretches[first].confirmed) stretches.splice(first, 1); }
    if (stretches.some(s => s.row === r.id)) fieldRows.push({ id: r.id, plants: r.dots.length, certain, perM: Math.round(r.perM * 100) / 100, kind: r.kind });
  }
  if (!stretches.some(s => s.confirmed)) return null;
  // Every dot of the stricter marks, as before; a candidate only when it stands on a row.
  const kept: number[] = []; for (let i = 0; i < all.length; i++) if (i < strict || rec.rowOf[i] >= 0) kept.push(i);
  // A double (q.doublesApart): on a row's line, refused only as too close to a plant on that row.
  const apart = (opts.sequence ?? SEQUENCE).doublesApart;
  const shown = kept.map(i => (i >= strict ? (rec.secondLook?.[i] ? 6 : tier![i] === 1 ? 4 : 5) : rec.rowOf[i] >= 0 ? (rec.certainty[i] === 0 ? 0 : 1) : apart && rec.settled[i] === SETTLED.tooClose ? 7 : rec.between[i] ? 3 : 2));
  const cnt = [0, 0, 0, 0, 0, 0, 0, 0]; for (const v of shown) cnt[v]++;
  const sumM = (ok: boolean) => Math.round(stretches.filter(s => s.confirmed === ok).reduce((t, s) => t + s.lengthM, 0) * 10) / 10;
  return {
    points: kept.map(i => ll(all[i].e, all[i].n)), shown, photos: kept.map(i => all[i].photos), stretches, rows: fieldRows,
    ...(opts.free ? { loose: kept.map(i => (rec.rowOf[i] >= 0 && (rec.loose[i] || tier?.[i] === 3) ? 1 : 0)) } : {}),
    geometry: { spacingM: G.spacingM, directionDeg: G.directionDeg, seedM: G.seedM, certainRows: G.certainRows, certainDots: G.certainDots },
    summary: { plants: kept.length, certain: cnt[0], probable: cnt[1], onNoRow: cnt[2], betweenRows: cnt[3], rows: rec.rows.length, confirmedM: sumM(true), notConfirmedM: sumM(false), ...(tier ? { alongRowsTwo: cnt[4], alongRowsOne: cnt[5] } : {}), ...(opts.free ? { loosened: kept.filter(i => rec.rowOf[i] >= 0 && (rec.loose[i] || tier?.[i] === 3)).length } : {}), ...(rec.secondLook ? { secondLook: kept.filter(i => rec.secondLook![i]).length } : {}), ...(apart ? { doubles: cnt[7] } : {}) },
  };
}

/** A stretch of a row's course from exactly `a0` to exactly `a1` along the row direction (cos, sin): its own points
 * inside, the ends interpolated on the course. */
export function stretchLine(line: [number, number][], a0: number, a1: number, ct: number, st: number): [number, number][] {
  if (!line.length) return [];
  const ac = line.map(([e, n]) => [e * ct + n * st, -e * st + n * ct] as [number, number]).sort((x, y) => x[0] - y[0]);
  const cAt = (a: number) => {
    if (a <= ac[0][0]) return ac[0][1];
    if (a >= ac[ac.length - 1][0]) return ac[ac.length - 1][1];
    for (let k = 0; k + 1 < ac.length; k++) if (a >= ac[k][0] && a <= ac[k + 1][0]) return ac[k][1] + ((a - ac[k][0]) / (ac[k + 1][0] - ac[k][0] || 1)) * (ac[k + 1][1] - ac[k][1]);
    return ac[0][1];
  };
  const pts: [number, number][] = [[a0, cAt(a0)], ...ac.filter(([a]) => a > a0 + 1e-6 && a < a1 - 1e-6), [a1, cAt(a1)]];
  return pts.map(([a, c]) => [a * ct - c * st, a * st + c * ct]);
}

/**
 * Read only (2026-11-20): for each plant of `cornPlantsOf`, in its order, the marks it was made from: the photograph
 * and the mark's pixel in it. `k`: the mark's index in that photograph's stricter marks, or -1 for a lower-bar
 * candidate. For each plant's own look (cornPlantLook.ts) and for the founder's "photographs that marked it".
 */
export function plantSightings(P: PlacedDots, rec: { rowOf: Int32Array }): { photo: string; u: number; v: number; k: number }[][] {
  const out: { photo: string; u: number; v: number; k: number }[][] = [], S = P.sights ?? [], C = P.candidates;
  for (let i = 0; i < P.all.length; i++) {
    if (!(i < P.strict || rec.rowOf[i] >= 0)) continue;
    if (i < P.strict) out.push(P.all[i].members.map(m => ({ photo: P.photos[S[m].p], u: S[m].u, v: S[m].v, k: S[m].k ?? -1 })));
    else out.push((C?.members[i - P.strict] ?? []).map(j => { const f = C!.from[j]; return { photo: P.photos[f.p], u: f.u, v: f.v, k: f.sight >= 0 ? S[f.sight].k ?? -1 : -1 }; }));
  }
  return out;
}
