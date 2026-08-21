// Treated grid cells, merged into polygons the Flight Planner already speaks.
//
// The Treatment Grid and the planner grew up separately: the planner routes
// over zones (AI-drawn or hand-drawn rings), the grid holds per-cell rates,
// and until this module the two never met — an operator could paint a whole
// prescription and the flight plan would ignore every cell of it. This is the
// bridge, and it deliberately produces the planner's EXISTING shape rather
// than a third zone system.
//
// MERGING, NOT ONE ZONE PER CELL. Contiguous treated cells (4-adjacent, same
// rate) become one polygon. Same-rate matters: a zone has one rate, and
// splitting on rate is what lets the chemical volume stay exactly the grid's
// own arithmetic — Σ(cell area × cell rate) — rather than an average smeared
// over a merged blob.
//
// AREA IS CARRIED, NOT RECOMPUTED. Each zone carries the sum of its member
// cells' TRUE CLIPPED areas. The outline is traced on the unclipped lattice
// (edge cells may poke slightly past the boundary, exactly like a hand-drawn
// ring can), so ring area and treated area differ at the field edge — and the
// prescription numbers must come from the latter. Consumers that price a zone
// must use `areaM2`, never re-derive it from the ring; that is the same
// one-calculation-path rule the mission stats follow.
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng, rotateLL } from "./geo";
import { parseCellId } from "./gridMigrate";
import { type CellId, type TreatmentGrid, cellSizeM } from "./treatmentGrid";

export type GridZone = {
  /** Stable within a grid: derived from the gridId and the group's anchor cell. */
  id: string;
  ring: LatLng2[];
  rateLha: number;
  /** Σ member cells' clipped areas — the number the prescription is priced on. */
  areaM2: number;
  cellCount: number;
  /**
   * The cells this shape is a projection of.
   *
   * Carried so an edit made ON the zone can be written to the cells that
   * compose it, which is the only place a classification is allowed to live.
   * Without this a caller would have to re-derive membership from the ring and
   * could get a different answer than the projection did.
   */
  cellIds: CellId[];
  source: "grid";
  /**
   * The operator's own classification, or undefined — which readers must show
   * as "Unclassified", never guess into a category. Same vocabulary as
   * hand-drawn anomaly polygons.
   */
  issue?: string;
  /** The operator's own words about this ground, if they wrote any. */
  note?: string;
  /**
   * Mean Find-Similar score over the member cells that carry one, or null when
   * none do. This is a MATCH score, not a confidence: it says how much this
   * ground resembled the operator's examples when it was last scored, and a
   * hand-painted zone with no scores simply has none.
   */
  matchScore: number | null;
};

type Cell = { id: CellId; col: number; row: number; areaM2: number; score: number | null };

/**
 * All treated cells, grouped and outlined.
 *
 * Sorted deterministically so the same grid always yields the same zones in
 * the same order — zone ids feed the planner's per-zone UI, and an id that
 * moves between renders is a rate override landing on the wrong zone.
 */
export function gridZonesFor(grid: TreatmentGrid): GridZone[] {
  // Bucket treated cells by (rate, issue, note); contiguity is found within a
  // bucket. Issue splits a bucket for the same reason rate does: a zone
  // carries ONE classification, and merging "weed pressure" ground into a
  // "bare soil" zone would misdescribe both. The note splits it for the same
  // reason again — a popup showing one note over cells that disagree would be
  // showing a note about ground it does not describe.
  type Bucket = { rateLha: number; issue?: string; note?: string; cells: Map<string, Cell> };
  const byKey = new Map<string, Bucket>();
  for (const c of grid.cells) {
    if (c.rate.state !== "treated") continue;
    const parsed = parseCellId(c.id);
    if (!parsed) continue;
    const issue = c.rate.issue;
    const note = c.rate.note;
    // NUL separates the parts: it cannot occur in an issue or a note, so no
    // combination of the two can collide with a different combination.
    const key = `${c.rate.rateLha}\u0000${issue ?? ""}\u0000${note ?? ""}`;
    let bucket = byKey.get(key);
    if (!bucket) byKey.set(key, (bucket = { rateLha: c.rate.rateLha, issue, note, cells: new Map() }));
    bucket.cells.set(`${parsed.col},${parsed.row}`, {
      id: c.id, col: parsed.col, row: parsed.row, areaM2: c.areaM2,
      score: c.detection?.score ?? null,
    });
  }

  const zones: GridZone[] = [];
  for (const [, { rateLha, issue, note, cells: bucket }] of
       [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const seen = new Set<string>();
    const keys = [...bucket.keys()].sort();
    for (const start of keys) {
      if (seen.has(start)) continue;
      // 4-adjacency flood fill: diagonal contact is not contiguity — a sprayer
      // cannot treat two corner-touching cells as one area.
      const group: Cell[] = [];
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const k = queue.pop()!;
        const cell = bucket.get(k)!;
        group.push(cell);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nk = `${cell.col + dc},${cell.row + dr}`;
          if (bucket.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
        }
      }
      zones.push(...zonesFromGroup(grid, group, rateLha, issue, note));
    }
  }
  return zones;
}

/** One contiguous same-rate group → one polygon, or strips when it has holes. */
function zonesFromGroup(
  grid: TreatmentGrid, group: Cell[], rateLha: number, issue?: string, note?: string,
): GridZone[] {
  const loops = traceOutline(group);
  const anchor = group.reduce((a, c) => (c.row < a.row || (c.row === a.row && c.col < a.col) ? c : a));
  const areaM2 = group.reduce((s, c) => s + c.areaM2, 0);
  const scored = group.filter(c => c.score !== null);
  const matchScore = scored.length
    ? scored.reduce((s, c) => s + (c.score as number), 0) / scored.length
    : null;

  if (loops.length === 1) {
    return [{
      id: `grid:${grid.id}:${anchor.col}:${anchor.row}`,
      ring: loops[0].map(v => latticeToWorld(grid, v.x, v.y)),
      rateLha, areaM2, cellCount: group.length,
      cellIds: group.map(c => c.id).sort(),
      source: "grid", issue, note, matchScore,
    }];
  }

  // More than one loop means the group encloses untreated ground — a hole.
  // A planner zone is a single ring, and swallowing the hole would spray a
  // cell somebody deliberately left alone. Decompose into horizontal strips
  // instead: more zones, zero chemical on undecided ground. Rare in practice.
  const byRow = new Map<number, Cell[]>();
  for (const c of group) {
    const list = byRow.get(c.row);
    if (list) list.push(c); else byRow.set(c.row, [c]);
  }
  const strips: GridZone[] = [];
  for (const [row, cells] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    cells.sort((a, b) => a.col - b.col);
    let runStart = 0;
    for (let i = 1; i <= cells.length; i++) {
      if (i < cells.length && cells[i].col === cells[i - 1].col + 1) continue;
      const run = cells.slice(runStart, i);
      const c0 = run[0].col, c1 = run[run.length - 1].col;
      const stripScored = run.filter(c => c.score !== null);
      strips.push({
        id: `grid:${grid.id}:${c0}:${row}`,
        ring: [
          latticeToWorld(grid, c0, row), latticeToWorld(grid, c1 + 1, row),
          latticeToWorld(grid, c1 + 1, row + 1), latticeToWorld(grid, c0, row + 1),
        ],
        rateLha,
        areaM2: run.reduce((s, c) => s + c.areaM2, 0),
        cellCount: run.length,
        cellIds: run.map(c => c.id).sort(),
        source: "grid",
        issue,
        note,
        matchScore: stripScored.length
          ? stripScored.reduce((s, c) => s + (c.score as number), 0) / stripScored.length
          : null,
      });
      runStart = i;
    }
  }
  return strips;
}

/** Lattice corner (col,row) → WGS84, replaying the grid builder's frame. */
export function latticeToWorld(grid: TreatmentGrid, col: number, row: number): LatLng2 {
  const def = grid.definition;
  const size = cellSizeM(def);
  const rotated = {
    lat: def.origin.lat + row * (size / M_PER_DEG_LAT),
    lng: def.origin.lng + col * (size / mPerDegLng(def.origin.lat)),
  };
  return rotateLL(rotated, def.origin, Math.cos(def.headingRad), Math.sin(def.headingRad));
}

type V = { x: number; y: number };

/**
 * Boundary loops of a set of lattice cells, by edge cancellation.
 *
 * Every cell contributes its four sides as directed edges (counter-clockwise);
 * an edge shared by two cells appears once in each direction and cancels.
 * What survives is the boundary. At a vertex where the boundary touches
 * itself (two cells meeting only diagonally inside one group), the walk takes
 * the rightmost available turn, which keeps each loop simple instead of
 * figure-eighting through the pinch.
 */
export function traceOutline(cells: readonly { col: number; row: number }[]): V[][] {
  const dirs: Record<string, true> = {};
  const key = (a: V, b: V) => `${a.x},${a.y}>${b.x},${b.y}`;
  const add = (a: V, b: V) => {
    const rev = key(b, a);
    if (dirs[rev]) delete dirs[rev]; else dirs[key(a, b)] = true;
  };
  for (const c of cells) {
    const [x, y] = [c.col, c.row];
    add({ x, y }, { x: x + 1, y });
    add({ x: x + 1, y }, { x: x + 1, y: y + 1 });
    add({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
    add({ x, y: y + 1 }, { x, y });
  }

  const outgoing = new Map<string, V[]>();
  for (const k of Object.keys(dirs)) {
    const [from, to] = k.split(">");
    const [fx, fy] = from.split(",").map(Number);
    const [tx, ty] = to.split(",").map(Number);
    const vk = `${fx},${fy}`;
    const list = outgoing.get(vk);
    const v = { x: tx, y: ty };
    if (list) list.push(v); else outgoing.set(vk, [v]);
  }

  const used = new Set<string>();
  const loops: V[][] = [];
  for (const k of Object.keys(dirs)) {
    if (used.has(k)) continue;
    const [from] = k.split(">");
    const [sx, sy] = from.split(",").map(Number);
    let cur: V = { x: sx, y: sy };
    let prev: V | null = null;
    const loop: V[] = [];
    for (;;) {
      const options = (outgoing.get(`${cur.x},${cur.y}`) ?? [])
        .filter(n => !used.has(key(cur, n)));
      if (!options.length) break;
      let next = options[0];
      if (options.length > 1 && prev) {
        // Rightmost turn relative to the incoming direction.
        const inDir = { x: cur.x - prev.x, y: cur.y - prev.y };
        const turn = (n: V) => {
          const out = { x: n.x - cur.x, y: n.y - cur.y };
          return inDir.x * out.y - inDir.y * out.x;   // cross product
        };
        next = options.reduce((best, n) => (turn(n) < turn(best) ? n : best));
      }
      used.add(key(cur, next));
      loop.push(cur);
      prev = cur;
      cur = next;
      if (cur.x === sx && cur.y === sy) break;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  // Outer loop first — it has the largest absolute area.
  return loops.sort((a, b) => Math.abs(shoelace(b)) - Math.abs(shoelace(a)));
}

const shoelace = (loop: V[]): number => {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};
