// Stage 3: rows and trees in every photograph, and one field-wide row map, without inventing rows. The port of
// scripts/directGeoref/m2Rows.ts (milestone 2), with the same three passes per photograph and the same field
// rules; see that script's header and docs/features/swardus-direct-milestones.md.
import { type AdjustModel, type GeorefFrame, type Observation, type ReconciledObject, groundToPixel, pixelToGround, reconcile } from "../../directGeoref";
import type { PhotoPixels } from "../../photoScout/pattern";
import { toEnu } from "../../sourceFrames/odm";
import { MIN_ROW_SIZE_SHARE, coverMask, fieldRowsFromPixels, shadowMask, vegetationMask } from "../../weedVision/fieldRows";
import { fitLayoutAll, latticeFromClicks, layoutsToFieldRows, mergeLayouts, rasterFromMask, type LayoutRaster } from "../../weedVision/layout/plantingLayout";
import { proposeFromRows } from "../../weedVision/layout/readLayout";
import { mercatorPx } from "../../weedVision/mapRun";
import { yieldToEvents } from "./cameras";
import { type BuildHooks, checkCancelled } from "./types";

const Z = 22;
const RELAXED_SHARE = 0.1;
const quant = (v: number[], q: number) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(q * (s.length - 1))] : NaN; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

type Tree = { u: number; v: number; rM: number; rPx: number; state: string; merged: boolean };
type Line = { u1: number; v1: number; u2: number; v2: number };
export type PhotoRowRead = {
  name: string; source: "reader" | "reader, young trees kept" | "seeded from the field" | "none"; reason?: string;
  rowSpacingM?: number; plantSpacingM?: number; directionGroundDeg?: number;
  trees: Tree[]; lines: Line[];
};

export type RowsTree = { id: number; lat: number; lng: number; heightM: number | null; crownRadiusM: number; seenBy: number; coveredBy: number; viewSpreadM: number; sizeCv: number; observed: boolean; members: { frame: string; u: number; v: number; rM: number; state: string }[] };
export type RowsRow = { id: number; kept: boolean; reason: string | null; trees: number; inferred: number; photos: number; photosWithOwnRows: number; lengthM: number; straightnessSdM: number; line: [number, number][]; treeIds: number[] };
export type RowsResult = {
  field: { directionDeg: number; rowSpacingM: number; plantSpacingM: number; directionRefinedDeg: number };
  trees: RowsTree[];
  rows: RowsRow[];
  inferred: { row: number; lat: number; lng: number }[];
  offRowTreeIds: number[];
  perPhoto: PhotoRowRead[];
  report: Record<string, unknown>;
};

type Prepared = { px: PhotoPixels; f: GeorefFrame; mpp: number; k: number; left: number; top: number; r: LayoutRaster; down: number };

/**
 * Rows and trees from the aligned cameras. `pixels(name)` gives a photograph decoded at `down` (quarter size).
 * Returns null when no photograph reads rows at all (a field without rows, or none the reader understands).
 */
export async function rowsAndTrees(frames: Map<string, GeorefFrame>, model: AdjustModel, pixels: (name: string) => Promise<PhotoPixels>, hooks: BuildHooks = {}, rasterCellM = 0.08): Promise<RowsResult | null> {
  const t0 = Date.now();
  const groundAlt = model.globals.groundOffsetM;
  const origin = model.origin;
  const names = [...frames.keys()];

  async function prepare(name: string): Promise<Prepared> {
    const px = await pixels(name), f = frames.get(name)!;
    // The decode ratio of this photograph (a quarter decode, or a preview): original pixels per decoded pixel.
    const down = f.intrinsics.width / px.width;
    const mpp = ((f.pose.altM - groundAlt) / f.intrinsics.fx) * down;
    const [cx, cy] = mercatorPx(f.pose.lat, f.pose.lng, Z);
    const left = Math.round(cx - px.width / 2), top = Math.round(cy - px.height / 2);
    // The fitter's raster cell: the whole number of decoded pixels whose size is nearest `rasterCellM` (8 cm) in
    // ratio: two quarter-size pixels (7.8 cm), two preview pixels (11.2 cm rather than one of 5.6: measured on
    // the apricot flight, one pixel changed the fitter's count by 3 %, two by 0.2 %).
    const lo = Math.max(1, Math.floor(rasterCellM / mpp)), hi = lo + 1;
    const k = Math.abs(Math.log((hi * mpp) / rasterCellM)) < Math.abs(Math.log((lo * mpp) / rasterCellM)) ? hi : lo;
    const ring: [number, number][] = [[left, top], [left + px.width, top], [left + px.width, top + px.height], [left, top + px.height]];
    const r = rasterFromMask(vegetationMask(px), px.width, px.height, k, Z, left, top, mpp, [ring], shadowMask(px), coverMask(px));
    return { px, f, mpp, k, left, top, r, down };
  }
  function fit(p: Prepared, clicksPx: [number, number][]): { trees: Tree[]; lines: Line[] } | null {
    const clicks = clicksPx.map(([x, y]) => [x / p.k, y / p.k] as [number, number]);
    const L0 = latticeFromClicks(clicks[0], clicks[1], clicks[2]);
    if (!L0) return null;
    const fits = fitLayoutAll(L0, p.r, clicks);
    const merged = mergeLayouts(fits);
    const rows = layoutsToFieldRows(fits, p.r);
    const o = (q: number) => q * p.down;
    return {
      trees: merged.flatMap(m => m.plants).map(t => ({ u: o((t.x + 0.5) * p.k), v: o((t.y + 0.5) * p.k), rM: t.r * p.r.mpp, rPx: o(t.r * p.k), state: t.state, merged: t.merged })),
      lines: (rows?.ctx.lines ?? []).map(l => ({ u1: o(l.x1 + 0.5), v1: o(l.y1 + 0.5), u2: o(l.x2 + 0.5), v2: o(l.y2 + 0.5) })),
    };
  }
  function fromReader(p: Prepared, share: number) {
    const fr = fieldRowsFromPixels(p.px, p.mpp, undefined, share);
    if (!fr) return null;
    const prop = proposeFromRows({ ...fr, z: Z, left: p.left, top: p.top, mpp: p.mpp });
    if (!prop) return null;
    const clicks = prop.points.map(q => { const [X, Y] = mercatorPx(q.lat, q.lng, Z); return [X - p.left, Y - p.top] as [number, number]; });
    const res = fit(p, clicks);
    if (!res) return null;
    const th = (fr.directionDeg * Math.PI) / 180, cu = p.f.intrinsics.cx, cv = p.f.intrinsics.cy;
    const a = pixelToGround(p.f, cu, cv), b = pixelToGround(p.f, cu + 400 * Math.cos(th), cv + 400 * Math.sin(th));
    const dir = a && b ? (((Math.atan2(b.northM - a.northM, b.eastM - a.eastM) * 180) / Math.PI) % 180 + 180) % 180 : NaN;
    return { ...res, rowSpacingM: fr.spacingM, plantSpacingM: fr.seedSpacingM, directionGroundDeg: dir };
  }

  // Pass 1: the reader with its default rules.
  const reads = new Map<string, PhotoRowRead>();
  for (const [i, name] of names.entries()) {
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "rows", done: i, total: names.length * 2, message: `${name}: reading rows`, elapsedMs: Date.now() - t0 });
    await yieldToEvents();
    const p = await prepare(name);
    const r = fromReader(p, MIN_ROW_SIZE_SHARE);
    reads.set(name, r ? { name, source: "reader", trees: r.trees, lines: r.lines, rowSpacingM: r.rowSpacingM, plantSpacingM: r.plantSpacingM, directionGroundDeg: r.directionGroundDeg } : { name, source: "none", trees: [], lines: [] });
  }
  const pass1 = [...reads.values()].filter(r => r.source === "reader");
  hooks.log?.(`rows read in ${pass1.length} of ${names.length} photographs by the reader's default rules`);
  if (!pass1.length) return null;

  const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
  const circMedian = (v: number[]) => { const ref = quant(v, 0.5); return quant(v.map(x => (angDiff(x, ref) === Math.abs(x - ref) ? x : x > ref ? x - 180 : x + 180)), 0.5); };
  function treesToObservations(rs: PhotoRowRead[]): Observation[] {
    return rs.flatMap(r => {
      const f = frames.get(r.name)!, { width: w, height: h } = f.intrinsics;
      return r.trees.map((t, i) => ({ frame: r.name, id: i + 1, u: t.u, v: t.v, sizeM: 2 * t.rM, areaM2: Math.PI * t.rM * t.rM, touchesEdge: t.u - t.rPx < 0 || t.v - t.rPx < 0 || t.u + t.rPx > w || t.v + t.rPx > h, data: { state: t.state, merged: t.merged, rM: t.rM } }));
    });
  }
  const field1 = {
    directionDeg: circMedian(pass1.map(r => r.directionGroundDeg!).filter(Number.isFinite)),
    rowSpacingM: quant(pass1.map(r => r.rowSpacingM!), 0.5),
    plantSpacingM: quant(pass1.map(r => r.plantSpacingM!), 0.5),
  };
  const trees1 = reconcile(treesToObservations(pass1), frames, { maxHeightM: 6 }).filter(t => t.seenBy >= 2);
  hooks.log?.(`field from pass 1: rows run ${r2(field1.directionDeg)} deg, ${r2(field1.rowSpacingM)} m apart, plants ${r2(field1.plantSpacingM)} m apart; ${trees1.length} trees reconciled`);

  // Passes 2 and 3 for the photographs the reader refused.
  const thF = (field1.directionDeg * Math.PI) / 180;
  let ux = Math.cos(thF), uy = Math.sin(thF);
  const enOf = (lat: number, lng: number) => { const e = toEnu({ lat, lng, altM: 0 }, origin); return [e[0], e[1]] as [number, number]; };
  function seedsFor(name: string, down: number): { clicks: [number, number][]; seedTrees: number[] } | null {
    const f = frames.get(name)!, { width: w, height: h } = f.intrinsics;
    const inside = trees1.map(t => {
      const px = groundToPixel(f, t.lat, t.lng, groundAlt + (t.heightM ?? 1));
      const [e, n] = enOf(t.lat, t.lng);
      return px && px.u > 0.05 * w && px.v > 0.05 * h && px.u < 0.95 * w && px.v < 0.95 * h ? { t, u: px.u, v: px.v, along: e * ux + n * uy, across: -e * uy + n * ux } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    if (inside.length < 3) return null;
    const cu = w / 2, cv = h / 2;
    inside.sort((a, b) => Math.hypot(a.u - cu, a.v - cv) - Math.hypot(b.u - cu, b.v - cv));
    const S = field1.plantSpacingM, R = field1.rowSpacingM;
    for (const a of inside.slice(0, 25)) {
      const b = inside.find(q => q !== a && Math.abs(Math.abs(q.along - a.along) - S) < 0.25 * S && Math.abs(q.across - a.across) < 0.3 * S);
      if (!b) continue;
      const c = inside.filter(q => Math.abs(Math.abs(q.across - a.across) - R) < 0.2 * R && Math.abs(q.along - a.along) <= 0.5 * S).sort((p, q) => Math.abs(p.along - a.along) - Math.abs(q.along - a.along))[0];
      if (!c) continue;
      return { clicks: [a, b, c].map(q => [q.u / down, q.v / down] as [number, number]), seedTrees: [a.t.id, b.t.id, c.t.id] };
    }
    return null;
  }
  const counts = { relaxed: 0, relaxedRejected: 0, seeded: 0, none: 0 };
  let k = 0;
  for (const r of reads.values()) {
    k++;
    if (r.source === "reader") continue;
    checkCancelled(hooks.signal);
    hooks.onProgress?.({ stage: "rows", done: names.length + k, total: names.length * 2, message: `${r.name}: reading again`, elapsedMs: Date.now() - t0 });
    await yieldToEvents();
    const p = await prepare(r.name);
    const b = fromReader(p, RELAXED_SHARE);
    if (b) {
      const agree = angDiff(b.directionGroundDeg, field1.directionDeg) <= 3 && Math.abs(b.rowSpacingM - field1.rowSpacingM) <= 0.15 * field1.rowSpacingM && Math.abs(b.plantSpacingM - field1.plantSpacingM) <= 0.15 * field1.plantSpacingM;
      if (agree) { Object.assign(r, { source: "reader, young trees kept", trees: b.trees, lines: b.lines, rowSpacingM: b.rowSpacingM, plantSpacingM: b.plantSpacingM, directionGroundDeg: b.directionGroundDeg }); counts.relaxed++; continue; }
      counts.relaxedRejected++;
      r.reason = `lower size share read rows ${r2(b.rowSpacingM)} x ${r2(b.plantSpacingM)} m at ${r2(b.directionGroundDeg)} deg, which disagrees with the field`;
    }
    const s = seedsFor(r.name, p.down);
    if (s) {
      const res = fit(p, s.clicks);
      if (res && res.trees.length) { Object.assign(r, { source: "seeded from the field", trees: res.trees, lines: res.lines, reason: `seeded by trees ${s.seedTrees.join(", ")} reconciled from other photographs` }); counts.seeded++; continue; }
    }
    r.reason = (r.reason ? `${r.reason}; ` : "") + (s ? "the seeded fit found nothing" : "no three reconciled trees inside it to seed from");
    counts.none++;
  }
  const readAll = [...reads.values()].filter(r => r.source !== "none");
  hooks.log?.(`young trees kept: ${counts.relaxed} (${counts.relaxedRejected} disagreed); seeded from the field: ${counts.seeded}; unread: ${counts.none}`);

  // Trees, field-wide.
  const objs = reconcile(treesToObservations(readAll), frames, { maxHeightM: 6 });
  const observed = (o: ReconciledObject) => o.seenBy >= 2 || o.members.some(m => m.data?.state === "confirmed");
  const trees = objs.filter(observed);

  // Field rows from the trees: the direction refined on the trees, rows as peaks of the across offsets.
  type T2 = { o: ReconciledObject; along: number; across: number };
  const stackScore = (th: number) => { const bins = new Map<number, number>(); for (const o of trees) { const [e, n] = enOf(o.lat, o.lng); const kk = Math.round((-e * Math.sin(th) + n * Math.cos(th)) / 0.2); bins.set(kk, (bins.get(kk) ?? 0) + 1); } let sc = 0; for (const v of bins.values()) sc += v * v; return sc; };
  let thBest = thF, scBest = -1;
  for (let d = -2; d <= 2.0001; d += 0.02) { const th = thF + (d * Math.PI) / 180, sc = stackScore(th); if (sc > scBest) { scBest = sc; thBest = th; } }
  ux = Math.cos(thBest); uy = Math.sin(thBest);
  const directionRefinedDeg = (thBest * 180) / Math.PI;
  const t2: T2[] = trees.map(o => { const [e, n] = enOf(o.lat, o.lng); return { o, along: e * ux + n * uy, across: -e * uy + n * ux }; });
  if (!t2.length) return null;
  const R0 = field1.rowSpacingM, binW = 0.2;
  const lo = Math.min(...t2.map(t => t.across)) - 2, nb = Math.ceil((Math.max(...t2.map(t => t.across)) + 2 - lo) / binW);
  const hist = new Float64Array(nb);
  for (const t of t2) hist[Math.floor((t.across - lo) / binW)]++;
  const sm = hist.map((_, i) => { let v = 0; for (let kk = -2; kk <= 2; kk++) { const j = i + kk; if (j >= 0 && j < nb) v += hist[j] * Math.exp(-(kk * kk) / 2); } return v; });
  const peaks: number[] = [];
  const order = [...sm.keys()].sort((x, y) => sm[y] - sm[x]);
  for (const i of order) { if (sm[i] < 3) break; const c = lo + (i + 0.5) * binW; if (peaks.every(p => Math.abs(p - c) >= 0.6 * R0)) peaks.push(c); }
  peaks.sort((x, y) => x - y);
  const groups: T2[][] = peaks.map(() => []);
  const offRow: T2[] = [];
  for (const t of t2) { let bi = -1, bd = Infinity; peaks.forEach((p, i) => { const d = Math.abs(t.across - p); if (d < bd) { bd = d; bi = i; } }); if (bi >= 0 && bd <= 0.3 * R0) groups[bi].push(t); else offRow.push(t); }
  type FieldRow = { id: number; offsetM: number; trees: T2[]; photos: Set<string>; photosOwn: Set<string>; kept: boolean; reason?: string };
  const rows: FieldRow[] = groups.filter(g => g.length).map((g, i) => {
    const photos = new Set(g.flatMap(t => t.o.members.map(m => m.frame)));
    const photosOwn = new Set([...photos].filter(n => reads.get(n)!.source !== "seeded from the field"));
    return { id: i + 1, offsetM: quant(g.map(t => t.across), 0.5), trees: g.sort((a, b) => a.along - b.along), photos, photosOwn, kept: true };
  });
  // Straightness is judged robustly: the median absolute deviation of the trees from the row's line (scaled to a
  // standard deviation). The plain sd let a few trees of another planting crossing a row's end drop a row of 79
  // trees at 0.53 m against the 0.5 m allowed, and a 4 cm change in the cameras decided it (2026-10-28, the same
  // flight built in Node and in a browser kept different rows). The sd is still reported.
  const ROW_MIN_TREES = 4, ROW_MIN_PHOTOS = 2, ROW_MAX_SD_M = 0.5, ROW_MIN_FILL = 0.35;
  const robustSd = (v: number[]) => { const a = v.map(Math.abs); return 1.4826 * quant(a, 0.5); };
  for (const r of rows) {
    const offs = r.trees.map(t => t.across - r.offsetM), sd = Math.sqrt(offs.reduce((a, x) => a + x * x, 0) / offs.length), rsd = robustSd(offs);
    const len = r.trees[r.trees.length - 1].along - r.trees[0].along + field1.plantSpacingM;
    const fill = r.trees.length / Math.max(1, len / field1.plantSpacingM);
    if (r.trees.length < ROW_MIN_TREES) { r.kept = false; r.reason = `${r.trees.length} observed trees (${ROW_MIN_TREES} needed)`; }
    else if (r.photos.size < ROW_MIN_PHOTOS) { r.kept = false; r.reason = "seen in one photograph only"; }
    else if (rsd > ROW_MAX_SD_M) { r.kept = false; r.reason = `trees ${rsd.toFixed(2)} m off one straight line (robust sd; ${ROW_MAX_SD_M} allowed; plain sd ${sd.toFixed(2)})`; }
    else if (fill < ROW_MIN_FILL) { r.kept = false; r.reason = `observed trees on ${Math.round(fill * 100)} % of the positions along it (${ROW_MIN_FILL * 100} % needed)`; }
  }
  const kept = rows.filter(r => r.kept);
  const S = field1.plantSpacingM;
  const inferred: { row: number; along: number; across: number }[] = [];
  kept.forEach((r, i) => {
    const nbr = [kept[i - 1], kept[i + 1]].filter(q => q && Math.abs(Math.abs(q.offsetM - r.offsetM) - field1.rowSpacingM) < 0.3 * field1.rowSpacingM);
    if (nbr.length < 2) return;
    for (let j = 1; j < r.trees.length; j++) {
      const a = r.trees[j - 1].along, b = r.trees[j].along, kk = Math.round((b - a) / S);
      if (kk < 2 || (b - a) < 1.5 * S) continue;
      for (let m = 1; m < kk; m++) {
        const pos = a + ((b - a) * m) / kk;
        if (nbr.every(q => q.trees.some(t => Math.abs(t.along - pos) < 0.5 * S))) inferred.push({ row: r.id, along: pos, across: r.offsetM });
      }
    }
  });
  const llOf = (along: number, across: number) => { const e = along * ux - across * uy, n = along * uy + across * ux, lat0 = (origin.lat * Math.PI) / 180; return { lat: origin.lat + (n / 6378137) * (180 / Math.PI), lng: origin.lng + (e / (6378137 * Math.cos(lat0))) * (180 / Math.PI) }; };
  const rowsOut: RowsRow[] = rows.map(r => {
    const a0 = r.trees[0].along - S / 2, a1 = r.trees[r.trees.length - 1].along + S / 2;
    const offs = r.trees.map(t => t.across - r.offsetM);
    return {
      id: r.id, kept: r.kept, reason: r.reason ?? null, trees: r.trees.length, inferred: inferred.filter(x => x.row === r.id).length,
      photos: r.photos.size, photosWithOwnRows: r.photosOwn.size, lengthM: r2(a1 - a0), straightnessSdM: r3(Math.sqrt(offs.reduce((s, x) => s + x * x, 0) / offs.length)),
      line: [llOf(a0, r.offsetM), llOf(a1, r.offsetM)].map(p => [+p.lat.toFixed(8), +p.lng.toFixed(8)] as [number, number]),
      treeIds: r.trees.map(t => t.o.id),
    };
  });
  const gapsBetween = kept.slice(1).map((r, i) => r.offsetM - kept[i].offsetM);
  const report = {
    photographs: reads.size,
    readBy: { reader: pass1.length, youngTreesKept: counts.relaxed, seededFromField: counts.seeded, unread: counts.none },
    unread: [...reads.values()].filter(r => r.source === "none").map(r => ({ name: r.name, reason: r.reason })),
    field: { directionDeg: r2(field1.directionDeg), directionRefinedDeg: r2(directionRefinedDeg), rowSpacingM: r2(field1.rowSpacingM), plantSpacingM: r2(field1.plantSpacingM) },
    treesOffRows: offRow.length,
    trees: { objects: objs.length, observed: trees.length, seenBy: { median: quant(trees.map(t => t.seenBy), 0.5) }, viewSpreadM: r3(quant(trees.map(t => t.viewSpreadM), 0.5)), heightM: r2(quant(trees.map(t => t.heightM ?? NaN), 0.5)) },
    rows: {
      candidates: rows.length, kept: kept.length, dropped: rows.filter(r => !r.kept).map(r => ({ id: r.id, reason: r.reason })),
      spacingBetweenKeptRowsM: gapsBetween.length ? { median: r2(quant(gapsBetween, 0.5)), min: r2(Math.min(...gapsBetween)), max: r2(Math.max(...gapsBetween)) } : null,
      treesOffLineSdM: r3(quant(rowsOut.filter(r => r.kept).map(r => r.straightnessSdM), 0.5)),
      inferredPositions: inferred.length,
    },
  };
  hooks.log?.(`${trees.length} observed trees, ${kept.length} rows kept of ${rows.length}`);
  return {
    field: { ...field1, directionRefinedDeg },
    trees: objs.map(o => ({ id: o.id, lat: o.lat, lng: o.lng, heightM: o.heightM, crownRadiusM: o.sizeM / 2, seenBy: o.seenBy, coveredBy: o.coveredBy, viewSpreadM: o.viewSpreadM, sizeCv: o.sizeCv, observed: observed(o), members: o.members.map(m => ({ frame: m.frame, u: m.u, v: m.v, rM: m.data?.rM as number, state: m.data?.state as string })) })),
    rows: rowsOut, offRowTreeIds: offRow.map(t => t.o.id), inferred: inferred.map(x => ({ row: x.row, ...llOf(x.along, x.across) })),
    perPhoto: [...reads.values()].map(r => ({ ...r, trees: r.trees, lines: r.lines })),
    report,
  };
}
