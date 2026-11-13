// Corn in a Field Twin build: the plants first, then the rows through them (plantsFirst.ts), from the reads the corn
// stage already made. No photograph is decoded again: each read carries the plants its photograph located.
//
// What a build keeps from it:
//   plants   one dot per plant two or more photographs located, with what it is drawn as (certain / probable on a row,
//            seen on no row, between two rows: not the crop) and how many photographs hold it
//   rows     each row cut into stretches running exactly from a plant to a plant: "corn" where plants were seen along
//            it, "unconfirmed" where the row probably continues but no plant was confirmed (never across a headland)
// The corn stage's own rows (cornField) stay the fallback: a flight whose plants make no certain row keeps them.
import type { GeorefFrame } from "@/lib/directGeoref/projection";
import { fromEnu } from "@/lib/sourceFrames/odm";
import type { CornFieldResult, CornPhotoRead } from "./cornField";
import { PLANTS_FIRST, coverage, mergeDots, projectSightings, reconstruct, registerPhotos } from "./plantsFirst";

export type CornStretch = {
  /** The field row it belongs to, and whether plants were seen along it. */
  row: number; confirmed: boolean;
  /** Metres east/north of the field origin, and the same in latitude/longitude. */
  lineEN: [number, number][]; line: [number, number][];
  lengthM: number; why: string;
};

export type CornPlants = {
  /** Per plant: latitude, longitude. */
  points: [number, number][];
  /** Per plant: 0 a certain plant on a row, 1 a probable one, 2 seen on no row, 3 between two rows (not the crop). */
  shown: number[];
  /** Per plant: photographs that located it. */
  photos: number[];
  stretches: CornStretch[];
  geometry: { spacingM: number; directionDeg: number; seedM: number | null; certainRows: number; certainDots: number };
  summary: { plants: number; certain: number; probable: number; onNoRow: number; betweenRows: number; rows: number; confirmedM: number; notConfirmedM: number };
};

/** Shortest stretch kept, metres (a sliver at a row's end says nothing). */
const MIN_STRETCH_M = 0.3;

/** The plants and the rows through them; null when the plants make no certain row (the caller keeps cornField's rows). */
export function cornPlantsFirst(reads: CornPhotoRead[], frames: Map<string, GeorefFrame>, F: CornFieldResult): CornPlants | null {
  const { sights, photos } = projectSightings(reads, frames, F.origin);
  if (photos.length < 2 || sights.length < 50) return null;
  const reg = registerPhotos(sights, photos.length);
  const gateM = Math.min(PLANTS_FIRST.gateMax, Math.max(PLANTS_FIRST.gateMin, PLANTS_FIRST.gateTimes * reg.repeatM));
  const dots = mergeDots(sights, reg.shifts, gateM);
  if (!dots.length) return null;
  const covered = coverage(dots, frames, photos, reg.shifts, F.origin);
  const rec = reconstruct(dots, covered, F.directionDeg ?? 0, F.pitchM ?? 0.76);
  const G = rec.geometry;
  if (!G.certainRows || !rec.rows.length) return null;

  const ll = (e: number, n: number): [number, number] => { const p = fromEnu([e, n, 0], F.origin); return [Math.round(p.lat * 1e8) / 1e8, Math.round(p.lng * 1e8) / 1e8]; };
  const th = (G.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
  const stretches: CornStretch[] = [];
  for (const r of rec.rows) {
    const certain = r.dots.filter(i => rec.certainty[i] === 0).length;
    for (const g of r.segments) {
      const lineEN = stretchLine(r.line, g.a0, g.a1, ct, st);
      if (lineEN.length < 2) continue;
      const lengthM = lineEN.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - lineEN[i][0], p[1] - lineEN[i][1]), 0);
      if (lengthM < MIN_STRETCH_M) continue;
      stretches.push({
        row: r.id, confirmed: g.confirmed, lineEN, line: lineEN.map(([e, n]) => ll(e, n)), lengthM: Math.round(lengthM * 100) / 100,
        why: g.confirmed
          ? `Plants seen along it (row ${r.id}: ${r.dots.length} plants, ${certain} seen by most photographs over them, ${r.perM.toFixed(1)} a metre${r.kind === "geometry" ? "; found in a slot the certain rows leave" : ""}).`
          : `The row probably continues here (row ${r.id}), but no plant was confirmed on this stretch.`,
      });
    }
  }
  if (!stretches.some(s => s.confirmed)) return null;
  const shown = dots.map((_, i) => (rec.rowOf[i] >= 0 ? (rec.certainty[i] === 0 ? 0 : 1) : rec.between[i] ? 3 : 2));
  const cnt = [0, 0, 0, 0]; for (const v of shown) cnt[v]++;
  const sumM = (ok: boolean) => Math.round(stretches.filter(s => s.confirmed === ok).reduce((t, s) => t + s.lengthM, 0) * 10) / 10;
  return {
    points: dots.map(d => ll(d.e, d.n)), shown, photos: dots.map(d => d.photos), stretches,
    geometry: { spacingM: G.spacingM, directionDeg: G.directionDeg, seedM: G.seedM, certainRows: G.certainRows, certainDots: G.certainDots },
    summary: { plants: dots.length, certain: cnt[0], probable: cnt[1], onNoRow: cnt[2], betweenRows: cnt[3], rows: rec.rows.length, confirmedM: sumM(true), notConfirmedM: sumM(false) },
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
