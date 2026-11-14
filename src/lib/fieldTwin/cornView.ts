// Corn twins in the viewer: the words and colours for each state, and whether a twin is locally aligned. Shared by
// the corn panel, the inspector and the page (kept out of the component file so hot reload keeps working).
import { TWIN_COLOURS } from "./style";
import type { TwinBundle, TwinCorn, TwinCornGap, TwinCornRow, TwinCornWeed } from "./types";

export const CORN_WEED_LABEL: Record<TwinCornWeed["status"], string> = { confirmed: "Weed candidate, confirmed", unconfirmed: "Weed candidate, not confirmed", contested: "Contested: crop or weed" };
export const cornWeedColour = (s: TwinCornWeed["status"]) => (s === "confirmed" ? TWIN_COLOURS.cornWeed : s === "contested" ? TWIN_COLOURS.cornWeedContested : TWIN_COLOURS.cornWeedUnconfirmed);
export const cornGapColour = (s: TwinCornGap["status"]) => (s === "confirmed" ? TWIN_COLOURS.cornGap : TWIN_COLOURS.cornGapWithheld);
export const cornRowColour = (s: TwinCornRow["status"]) => (s === "corn" ? TWIN_COLOURS.cornRow : TWIN_COLOURS.cornRowUnconfirmed);

/** Is this twin's placement local (a test flight's estimated scale), not a place on the map? */
export const isLocalTwin = (twin: TwinBundle) => twin.source.placement?.kind === "local";

/**
 * A corn twin's rows as the field has them: one object per field row, made of its stretches (plants seen along them,
 * or the row's course where no plant was confirmed). A plants-first twin stores each stretch as a `TwinCornRow` with its
 * field row in `row`; twins saved before 2026-11-14 carry it only in the stretch's reason ("row 12: ..." / "(row 12)"),
 * and their confirmed stretches state the row's plants there. A lattice twin's rows are rows already (one stretch each).
 */
export type CornFieldRowView = {
  /** The field row's number (plants-first), or the row's own id (lattice). */
  id: number;
  /** Indexes into `corn.rows` (its stretches, in stored order). */
  stretches: number[];
  /** Plants-first: the stretches are pieces of one row through located plants. Lattice: one row the photographs drew. */
  plantsFirst: boolean;
  lengthM: number; confirmedM: number; notConfirmedM: number;
  /** Stretches with plants seen along them, and where the row continues with no plant confirmed. */
  confirmed: number; notConfirmed: number;
  /** Plants-first only (null when the twin does not say): plants on the row, how many most photographs over them
   * saw, per metre, how it was found. */
  plants: number | null; certain: number | null; perM: number | null; kind: "certain" | "geometry" | null;
};

// The reasons only cornPlants.ts writes (a lattice row's reason never starts so): "Plants seen along it (row 12: ...)"
// and "The row probably continues here (row 12), ...". Development twins of 2026-11-12 said "N certain" where the
// shipped ones say "N seen by most photographs over them".
const ROW_IN_WHY = /^(?:Plants seen along it \(row (\d+):|The row probably continues here \(row (\d+)\))/;
const STATS_IN_WHY = /\(row \d+: (\d+) plants, (\d+) (?:seen by most photographs over them|certain), ([\d.]+) a metre(; found in a slot)?/;

/** The field row a stored stretch belongs to: its `row`, else the one a plants-first reason names. */
export function fieldRowOf(_corn: TwinCorn, r: TwinCornRow): number | null {
  if (r.row != null) return r.row;
  const m = ROW_IN_WHY.exec(r.why);
  return m ? Number(m[1] ?? m[2]) : null;
}

export function cornFieldRows(corn: TwinCorn): CornFieldRowView[] {
  const stats = new Map((corn.fieldRows ?? []).map(f => [f.id, f]));
  const byRow = new Map<number, CornFieldRowView>(), out: CornFieldRowView[] = [];
  corn.rows.forEach((r, i) => {
    const fr = fieldRowOf(corn, r);
    let v = fr != null ? byRow.get(fr) : undefined;
    if (!v) {
      v = { id: fr ?? r.id, stretches: [], plantsFirst: fr != null, lengthM: 0, confirmedM: 0, notConfirmedM: 0, confirmed: 0, notConfirmed: 0, plants: null, certain: null, perM: null, kind: null };
      if (fr != null) {
        byRow.set(fr, v);
        const f = stats.get(fr);
        if (f) Object.assign(v, { plants: f.plants, certain: f.certain, perM: f.perM, kind: f.kind });
      }
      out.push(v);
    }
    v.stretches.push(i);
    v.lengthM += r.lengthM;
    if (r.status === "corn") { v.confirmedM += r.lengthM; v.confirmed++; } else { v.notConfirmedM += r.lengthM; v.notConfirmed++; }
    if (v.plantsFirst && v.plants == null && r.status === "corn") {
      const m = STATS_IN_WHY.exec(r.why);
      if (m) Object.assign(v, { plants: Number(m[1]), certain: Number(m[2]), perM: Number(m[3]), kind: m[4] ? "geometry" : "certain" });
    }
  });
  for (const v of out) { v.lengthM = Math.round(v.lengthM * 100) / 100; v.confirmedM = Math.round(v.confirmedM * 100) / 100; v.notConfirmedM = Math.round(v.notConfirmedM * 100) / 100; }
  return out;
}

/** Per stored row index, the index of its field row in `cornFieldRows` (for drawing and picking a row as one). */
export function fieldRowIndex(rows: CornFieldRowView[], n: number): Int32Array {
  const g = new Int32Array(n).fill(-1);
  rows.forEach((v, k) => { for (const i of v.stretches) g[i] = k; });
  return g;
}
