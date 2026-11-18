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
import { type Dot, PLANTS_FIRST, type PhotoShift, type PlantsFirstOptions, ROW_RECALL, type Reconstruction, type RowsFromDots, SEQUENCE, certainEvidence, coverage, mergeDots, projectSightings, reconstruct, registerPhotos, rowCandidates, rowsFromDots, type Sight } from "./plantsFirst";

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
   * found along a row at the lower bar (2026-11-16, probable): 4 by two or more photographs, 5 by one photograph's sharp view. */
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
    loosened?: number };
  /** Per plant: 1 when it is on its row only by the loosened placement (development, `free`). */
  loose?: number[];
};

/** Shortest stretch kept, metres (a sliver at a row's end says nothing). */
const MIN_STRETCH_M = 0.3;

export type CornPlantsOptions = {
  /** Development: the loosened placement on a row (plantsFirst.ts SEQUENCE.free, ROW_RECALL.anyView). */
  free?: boolean;
  /** The rules the rows are read by (default: SEQUENCE). */
  sequence?: typeof SEQUENCE;
  /** How the photographs are registered, the dots made and the first rows read (default: PLANTS_FIRST). */
  placing?: PlantsFirstOptions;
  /** The field's planted / scattered judgement of the ground (cornField.ts cornFieldAndGround): with it, nothing on
   * ground judged scattered is read as the planting (SEQUENCE.refuseScattered). Without it the ground is not asked. */
  ground?: FieldGround | null;
  /** false: a candidate that carries its extent along the rows (Corn V1 `rowSpans`) is split at the plant spacing one
   * photograph assumes (greenPoints.ts ROW_POINTS.seedM). Default: at the spacing the field's certain plants show,
   * and at the assumed one only where they show none. */
  fieldSeed?: boolean;
};

/**
 * A read's candidates for the rows as points: one per candidate, or, where a candidate's green runs along the
 * photograph's rows for more than `splitFrom` plant spacings (plants touching), one per plant spacing along it.
 * `seedM` is the plant spacing on the ground. Reads without extents (`lowSpan`) are returned as they are.
 */
export function candidatePoints(r: CornPhotoRead, f: GeorefFrame | undefined, origin: LatLngAlt, seedM: number, o: Pick<typeof ROW_POINTS, "splitFrom" | "maxSplit"> = ROW_POINTS): [number, number][] {
  const low = r.low ?? [], span = r.lowSpan, ax = r.lowAxis;
  if (!f || !span || !ax) return low;
  const out: [number, number][] = [];
  low.forEach(([x, y], i) => {
    const [lo, hi] = span[i] ?? [0, 0];
    const x0 = x + lo * ax[0], y0 = y + lo * ax[1], x1 = x + hi * ax[0], y1 = y + hi * ax[1];
    const g0 = hi > lo ? pixelToGround(f, x0 * r.scale, y0 * r.scale) : null, g1 = g0 ? pixelToGround(f, x1 * r.scale, y1 * r.scale) : null;
    if (!g0 || !g1) { out.push([x, y]); return; }
    const p0 = toEnu({ lat: g0.lat, lng: g0.lng, altM: 0 }, origin), p1 = toEnu({ lat: g1.lat, lng: g1.lng, altM: 0 }, origin), L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (L <= o.splitFrom * seedM) { out.push([x, y]); return; }
    const k = Math.min(o.maxSplit, Math.max(2, Math.round(L / seedM)));
    for (let b = 0; b < k; b++) { const t = (b + 0.5) / k; out.push([x0 + t * (x1 - x0), y0 + t * (y1 - y0)]); }
  });
  return out;
}

/** A flight's dots before any row is read: the stricter marks' dots first (`strict` of them), then the candidates for
 * the rows with their tier (plantsFirst.ts rowCandidates); how many photographs looked at each; and the first reading
 * of rows through the certain dots (direction, row spacing, plant spacing). */
export type PlacedDots = { photos: string[]; shifts: PhotoShift[]; repeatM: number; all: Dot[]; strict: number; tier: Uint8Array | null; covered: Int32Array; pre: RowsFromDots;
  /** Per dot, the ground's judgement where a caller made it itself (a script that moves the dots); else asked of `ground`. */
  groundState?: Uint8Array;
  /** Read only, for the corn inspector: the sightings the dots were merged from (`Dot.members` index them), and the
   * candidates' own sightings (plantsFirst.ts rowCandidates `from`, `members`; candidate i is dot `strict + i`). */
  sights?: Sight[]; /** Read only: the merging gate used, metres. */ gateM?: number; candidates?: { from: { p: number; u: number; v: number; sight: number }[]; members: number[][] } | null };

/** Steps 1 to 3 of plantsFirst.ts and the candidates for the rows; null when the photographs make no dot. */
export function placeDots(reads: CornPhotoRead[], frames: Map<string, GeorefFrame>, F: CornFieldResult, opts: CornPlantsOptions = {}): PlacedDots | null {
  const { sights, photos } = projectSightings(reads, frames, F.origin);
  if (photos.length < 2 || sights.length < 50) return null;
  const o = opts.placing ?? PLANTS_FIRST;
  const reg = registerPhotos(sights, photos.length, o);
  const gateM = Math.min(o.gateMax, Math.max(o.gateMin, o.gateTimes * reg.repeatM));
  const dots = mergeDots(sights, reg.shifts, gateM);
  if (!dots.length) return null;
  const q = opts.sequence ?? SEQUENCE;
  // The first reading of rows, through the certain dots alone (reconstruct takes it as given).
  const coveredStrict = coverage(dots, frames, photos, reg.shifts, F.origin);
  const pre = rowsFromDots(dots.filter((d, i) => certainEvidence(d, coveredStrict[i], q)), F.directionDeg ?? 0, F.pitchM ?? 0.76, o);
  // Plants along the rows the stricter marks left out (plantsFirst.ts rowCandidates): only where a photograph carried
  // candidates (seedlings on soil). The dots above stay as they are, first; a candidate is kept only on a row.
  const strict = dots.length;
  // A candidate long along the rows is plants touching: split at the plant spacing the certain plants show (the first
  // reading above), not at the one a single photograph assumes, where the read carries the candidates' extents.
  const seedM = opts.fieldSeed === false ? ROW_POINTS.seedM : pre.seedM ?? ROW_POINTS.seedM;
  const lowReads = reads.filter(r => r.low?.length).map(r => ({ name: r.name, scale: r.scale, plants: candidatePoints(r, frames.get(r.name), F.origin, seedM) }));
  let all = dots, tier: Uint8Array | null = null, covered = coveredStrict, candidates: PlacedDots["candidates"] = null;
  if (lowReads.length) {
    const C = rowCandidates(lowReads, frames, F.origin, photos, reg.shifts, sights, dots, F.directionDeg ?? 0, opts.free ? { ...ROW_RECALL, anyView: true } : ROW_RECALL);
    if (C.dots.length) {
      all = [...dots, ...C.dots]; tier = new Uint8Array(all.length); tier.set(C.tier, strict);
      covered = new Int32Array(all.length); covered.set(coveredStrict); covered.set(coverage(C.dots, frames, photos, reg.shifts, F.origin), strict);
      candidates = { from: C.from, members: C.members };
    }
  }
  return { photos, shifts: reg.shifts, repeatM: reg.repeatM, all, strict, tier, covered, pre, sights, gateM, candidates };
}

/** Steps 4 on: the rows through the certain dots, and every other dot against them (plantsFirst.ts reconstruct). */
export function readRows(P: PlacedDots, F: CornFieldResult, opts: CornPlantsOptions = {}): Reconstruction {
  const q = opts.sequence ?? SEQUENCE;
  return reconstruct(P.all, P.covered, F.directionDeg ?? 0, F.pitchM ?? 0.76, opts.placing ?? PLANTS_FIRST, opts.free ? { ...q, free: true } : q, P.tier ? Uint8Array.from(P.tier, t => (t ? 1 : 0)) : null, P.tier, P.pre, opts.ground ? { state: opts.ground.state, dotState: P.groundState ?? null } : null);
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
  for (const r of rec.rows) {
    const certain = r.dots.filter(i => rec.certainty[i] === 0).length;
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
    if (stretches.some(s => s.row === r.id)) fieldRows.push({ id: r.id, plants: r.dots.length, certain, perM: Math.round(r.perM * 100) / 100, kind: r.kind });
  }
  if (!stretches.some(s => s.confirmed)) return null;
  // Every dot of the stricter marks, as before; a candidate only when it stands on a row.
  const kept: number[] = []; for (let i = 0; i < all.length; i++) if (i < strict || rec.rowOf[i] >= 0) kept.push(i);
  const shown = kept.map(i => (i >= strict ? (tier![i] === 1 ? 4 : 5) : rec.rowOf[i] >= 0 ? (rec.certainty[i] === 0 ? 0 : 1) : rec.between[i] ? 3 : 2));
  const cnt = [0, 0, 0, 0, 0, 0]; for (const v of shown) cnt[v]++;
  const sumM = (ok: boolean) => Math.round(stretches.filter(s => s.confirmed === ok).reduce((t, s) => t + s.lengthM, 0) * 10) / 10;
  return {
    points: kept.map(i => ll(all[i].e, all[i].n)), shown, photos: kept.map(i => all[i].photos), stretches, rows: fieldRows,
    ...(opts.free ? { loose: kept.map(i => (rec.rowOf[i] >= 0 && (rec.loose[i] || tier?.[i] === 3) ? 1 : 0)) } : {}),
    geometry: { spacingM: G.spacingM, directionDeg: G.directionDeg, seedM: G.seedM, certainRows: G.certainRows, certainDots: G.certainDots },
    summary: { plants: kept.length, certain: cnt[0], probable: cnt[1], onNoRow: cnt[2], betweenRows: cnt[3], rows: rec.rows.length, confirmedM: sumM(true), notConfirmedM: sumM(false), ...(tier ? { alongRowsTwo: cnt[4], alongRowsOne: cnt[5] } : {}), ...(opts.free ? { loosened: kept.filter(i => rec.rowOf[i] >= 0 && (rec.loose[i] || tier?.[i] === 3)).length } : {}) },
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
