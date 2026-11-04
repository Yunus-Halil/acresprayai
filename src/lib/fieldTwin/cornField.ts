// Corn V1 over a whole field (2026-11-04): every photograph's read projected into the field's ground coordinates
// through Swardus Direct's camera frames, and the evidence of overlapping photographs combined.
//
// Corn V1 (src/lib/rowCrop/cornV1.ts) reads one photograph: rows with their evidence, crop identity and the findings
// it allows (weed candidates beside confirmed corn rows, stand gaps where both of its reads see nothing). A mapping
// flight sees every square metre in several photographs, so the field can ask more of each finding than one photo can:
//
//   rows      every photograph's rows projected to the ground (pixelToGround), turned into the field's row frame
//             (along, across) and grouped by their across position on the planting's lattice (one field row per
//             lattice line, cut where no photograph holds it for FIELD.rowBreakM). A field row is corn only where the
//             photographs that hold it mostly call it corn AND enough of the photographs covering it hold it at all
//             (a row one photo of four draws is one photo's opinion, not the field's).
//   weeds     every green patch Corn V1 judged (weed candidate, crop on a row, unknown vegetation) is a sighting; the
//             sightings of one patch in overlapping photographs are joined by Direct's reconcile (outline overlap,
//             one sighting per photograph); a field weed candidate needs the weed votes to lead, and never a photo
//             saying it is the crop on a row; a patch most covering photographs did not see at all is withheld.
//   gaps      every reported stand gap projected to its field row; a field gap stands only when no photograph that
//             covers it located a plant inside it, and at least half the photographs holding a corn row over it
//             reported it. The plant check is the strongest evidence a second photograph adds: a plant one frame
//             missed (dim corner, motion blur) is a plant another frame sees.
//
// Everything is review-only decision support: the outputs are rows, identities and candidate findings with the
// photographs behind each; nothing decides a treatment.
import { fromEnu, toEnu, type LatLngAlt } from "../sourceFrames/odm";
import { frameFootprint, groundSampleAt, groundToPixel, pixelToGround, type GeorefFrame } from "../directGeoref/projection";
import { reconcile, type Observation } from "../directGeoref/reconcile";
import type { CornV1Read } from "../rowCrop/cornV1";

export const CORN_FIELD_VERSION = 1;

export const FIELD = {
  /** Row pieces within this share of the field's row spacing across are the same field row. */
  sameRowShare: 0.25,
  /** A field row is cut where no photograph holds it for this long, metres. */
  rowBreakM: 1.5,
  /** Along-row bins for the field row's line, metres. */
  binM: 0.5,
  /** A field row is corn when photographs calling it corn hold at least this share of its observed length ... */
  cornShare: 0.5,
  /** ... and at least this share of the photographs covering it hold it (unless one photograph covers it). */
  minRepeat: 0.5,
  /** A projected row is sampled every this many metres. */
  sampleM: 0.25,
  /** Weed sightings: patches further apart than this are never one patch, metres. */
  weedSearchM: 0.6,
  /** A field weed candidate: weed votes at least this many (fewer only when fewer photographs covered it) ... */
  minWeedVotes: 2,
  /** ... and at least this share of the covering photographs saw the patch at all. */
  weedMinSeenShare: 0.34,
  /** Gaps: a plant located within this distance of a gap's line inside it (its first and last tenth left out) refutes it, metres. */
  gapPlantTolM: 0.06,
  /** Gaps from different photographs overlapping along the row by this share of the shorter are one gap. */
  gapOverlapShare: 0.3,
  /** Plausible row spacings for the field, metres. */
  pitchRangeM: [0.2, 1.6] as [number, number],
};

/** What the field needs from one photograph's Corn V1 read: small enough to send from a worker or cache to disk. */
export type CornPhotoRead = {
  name: string;
  /** Read pixels to original-frame pixels (a read made on a downscaled photo). */
  scale: number;
  rows: { points: [number, number][]; identity: "corn" | "probable crop"; evidence: string; confidence: "high" | "medium" }[];
  /** Every green patch Corn V1 judged, with its verdict (read pixels). */
  patches: { x: number; y: number; hull: [number, number][]; touchesEdge: boolean; verdict: "weed candidate" | "crop on a row" | "unknown vegetation" }[];
  gaps: { x1: number; y1: number; x2: number; y2: number; verdict: "stand gap" | "withheld" }[];
  /** Plants the plant read located (read pixels). */
  plants: [number, number][];
};

/** The compact form of a Corn V1 read for the field. */
export function compactCornRead(name: string, v: CornV1Read, scale = 1): CornPhotoRead {
  const verdictOf = new Map(v.weedVerdicts.map(w => [w.index, w.verdict]));
  return {
    name, scale,
    rows: v.rows.map(r => ({ points: r.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]), identity: r.identity, evidence: r.evidence, confidence: r.confidence })),
    patches: v.green.weeds.flatMap((w, i) => { const vd = verdictOf.get(i); return vd ? [{ x: w.x, y: w.y, hull: w.hull, touchesEdge: w.touchesEdge, verdict: vd }] : []; }),
    gaps: v.gaps.map(g => ({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, verdict: g.verdict })),
    plants: v.plants.points.map(p => [Math.round(p.x), Math.round(p.y)] as [number, number]),
  };
}

export type FieldRow = {
  id: number;
  identity: "corn" | "probable crop";
  /** Local metres east/north of the field origin, and the same line in latitude/longitude. */
  lineEN: [number, number][];
  line: [number, number][];
  lengthM: number;
  /** Photographs that hold the row, that call it corn, and that cover its middle. */
  seenBy: number; cornBy: number; coveredBy: number;
  why: string;
};
export type FieldWeedVerdict = "weed candidate" | "crop on a row" | "unknown vegetation";
export type FieldWeed = {
  id: number; lat: number; lng: number; e: number; n: number; areaM2: number;
  verdict: FieldWeedVerdict;
  votes: Record<FieldWeedVerdict, number>;
  seenBy: number; coveredBy: number;
  photos: string[];
  why: string;
};
export type FieldGap = {
  id: number; row: number;
  /** Ends, local metres and latitude/longitude. */
  aEN: [number, number]; bEN: [number, number]; a: [number, number]; b: [number, number];
  lengthM: number;
  verdict: "stand gap" | "withheld";
  reportedBy: string[];
  /** Photographs holding a corn row over it that did not report it. */
  notReportedBy: string[];
  /** Photographs that located a plant inside it. */
  plantSeenBy: string[];
  why: string;
};
export type CornFieldResult = {
  version: number;
  origin: LatLngAlt;
  /** The rows' direction, degrees counterclockwise from east, [0, 180). */
  directionDeg: number | null;
  pitchM: number | null;
  rows: FieldRow[];
  weeds: FieldWeed[];
  gaps: FieldGap[];
  /** Row pieces' across scatter about their field row, metres (median absolute): how well the photographs agree. */
  rowAgreementM: number | null;
  summary: {
    photographs: number; cornRows: number; probableRows: number; cornRowLengthM: number;
    weeds: number; weedsWithheld: number; cropOnRow: number;
    gaps: number; gapLengthM: number; gapsWithheld: number;
    /** What the single photographs said, for comparison. */
    perPhoto: { weedCandidates: number; standGaps: number; rows: number };
    ms: number;
  };
  notes: string[];
};

type Piece = { photo: string; identity: "corn" | "probable crop"; ac: [number, number][]; c: number; a0: number; a1: number };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const inRing = (ring: [number, number][], e: number, n: number) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) hit = !hit; }
  return hit;
};

/** Corn V1's per-photograph reads combined over a field, in Swardus Direct's ground coordinates. */
export function cornField(reads: CornPhotoRead[], frames: Map<string, GeorefFrame>, o = FIELD): CornFieldResult {
  const t0 = Date.now(), notes: string[] = [];
  const used = reads.filter(r => frames.has(r.name));
  const fs = used.map(r => frames.get(r.name)!);
  const origin: LatLngAlt = fs.length ? { lat: fs.reduce((s, f) => s + f.pose.lat, 0) / fs.length, lng: fs.reduce((s, f) => s + f.pose.lng, 0) / fs.length, altM: 0 } : { lat: 0, lng: 0, altM: 0 };
  const en = (lat: number, lng: number): [number, number] => { const v = toEnu({ lat, lng, altM: 0 }, origin); return [v[0], v[1]]; };
  const ll = (e: number, n: number): [number, number] => { const p = fromEnu([e, n, 0], origin); return [p.lat, p.lng]; };
  const ground = (f: GeorefFrame, u: number, v: number): [number, number] | null => { const g = pixelToGround(f, u, v); return g ? en(g.lat, g.lng) : null; };
  const foot = new Map<string, [number, number][]>();
  for (const r of used) { const fp = frameFootprint(frames.get(r.name)!); if (fp) foot.set(r.name, fp.map(g => en(g.lat, g.lng))); }
  const covering = (e: number, n: number) => used.filter(r => { const ring = foot.get(r.name); return ring ? inRing(ring, e, n) : false; }).map(r => r.name);
  const gsdOf = new Map(used.map(r => { const f = frames.get(r.name)!; return [r.name, groundSampleAt(f, f.intrinsics.width / 2, f.intrinsics.height / 2) ?? 0.01] as const; }));

  // Rows projected, densified about every sampleM on the ground.
  const projected: { photo: string; identity: "corn" | "probable crop"; pts: [number, number][] }[] = [];
  for (const r of used) {
    const f = frames.get(r.name)!, stepPx = o.sampleM / (gsdOf.get(r.name)! * r.scale);
    for (const row of r.rows) {
      const pts: [number, number][] = [];
      for (let i = 0; i < row.points.length; i++) {
        const [x0, y0] = row.points[i], [x1, y1] = row.points[Math.min(row.points.length - 1, i + 1)];
        const k = i + 1 < row.points.length ? Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / stepPx)) : 1;
        for (let j = 0; j < k; j++) { const g = ground(f, (x0 + ((x1 - x0) * j) / k) * r.scale, (y0 + ((y1 - y0) * j) / k) * r.scale); if (g) pts.push(g); }
      }
      if (pts.length >= 2) projected.push({ photo: r.name, identity: row.identity, pts });
    }
  }
  // The field's row direction: the length-weighted mean of the segments' doubled angles (rows have no head or tail).
  let sx = 0, sy = 0;
  for (const p of projected) for (let i = 1; i < p.pts.length; i++) { const de = p.pts[i][0] - p.pts[i - 1][0], dn = p.pts[i][1] - p.pts[i - 1][1], L = Math.hypot(de, dn), t = Math.atan2(dn, de); sx += L * Math.cos(2 * t); sy += L * Math.sin(2 * t); }
  const theta = projected.length ? Math.atan2(sy, sx) / 2 : 0;
  const directionDeg = projected.length ? ((theta * 180) / Math.PI + 180) % 180 : null;
  const ct = Math.cos(theta), st = Math.sin(theta);
  const toAC = (e: number, n: number): [number, number] => [e * ct + n * st, -e * st + n * ct];
  const fromAC = (a: number, c: number): [number, number] => [a * ct - c * st, a * st + c * ct];
  const pieces: Piece[] = projected.map(p => { const ac = p.pts.map(([e, n]) => toAC(e, n)); return { photo: p.photo, identity: p.identity, ac, c: median(ac.map(q => q[1])), a0: Math.min(...ac.map(q => q[0])), a1: Math.max(...ac.map(q => q[0])) }; });
  // The field's row spacing: neighbouring rows' across distances within each photograph.
  const diffs: number[] = [];
  for (const r of used) { const cs = pieces.filter(p => p.photo === r.name).map(p => p.c).sort((a, b) => a - b); for (let i = 1; i < cs.length; i++) { const d = cs[i] - cs[i - 1]; if (d >= o.pitchRangeM[0] && d <= o.pitchRangeM[1]) diffs.push(d); } }
  const pitchM = diffs.length ? median(diffs) : null;
  if (!pitchM) notes.push("No row spacing could be measured across the photographs: rows are kept per photograph only.");

  // Field rows: pieces grouped across on the lattice, then cut along where nothing holds them.
  const rows: FieldRow[] = [];
  let agreement: number[] = [];
  if (pitchM) {
    const sorted = [...pieces].sort((p, q) => p.c - q.c), clusters: Piece[][] = [];
    for (const p of sorted) { const last = clusters[clusters.length - 1]; if (last && Math.abs(p.c - median(last.map(q => q.c))) <= o.sameRowShare * pitchM) last.push(p); else clusters.push([p]); }
    for (const cl of clusters) {
      const cMid = median(cl.map(p => p.c));
      agreement = agreement.concat(cl.map(p => Math.abs(p.c - cMid)));
      // Along: the union of the pieces' spans, cut at breaks.
      const spans = cl.map(p => [p.a0, p.a1] as [number, number]).sort((a, b) => a[0] - b[0]), runs: [number, number][] = [];
      for (const s of spans) { const last = runs[runs.length - 1]; if (last && s[0] <= last[1] + o.rowBreakM) last[1] = Math.max(last[1], s[1]); else runs.push([...s]); }
      for (const [r0, r1] of runs) {
        const inRun = cl.filter(p => p.a1 >= r0 && p.a0 <= r1);
        const lineAC: [number, number][] = [];
        for (let a = r0; a <= r1 + 1e-9; a += o.binM) { const cs = inRun.flatMap(p => p.ac.filter(q => q[0] >= a - o.binM / 2 && q[0] < a + o.binM / 2).map(q => q[1])); if (cs.length) lineAC.push([a, median(cs)]); }
        if (lineAC.length < 2) continue;
        const lineEN = lineAC.map(([a, c]) => fromAC(a, c));
        const len = (r1 - r0);
        const lenOf = (ps: Piece[]) => ps.reduce((s, p) => s + Math.max(0, Math.min(p.a1, r1) - Math.max(p.a0, r0)), 0);
        const seen = new Set(inRun.map(p => p.photo)), corn = new Set(inRun.filter(p => p.identity === "corn").map(p => p.photo));
        const mid = fromAC((r0 + r1) / 2, cMid), cov = new Set([...covering(mid[0], mid[1]), ...seen]);
        const cornLen = lenOf(inRun.filter(p => p.identity === "corn")), allLen = lenOf(inRun);
        const repeat = seen.size / Math.max(1, cov.size);
        let identity: "corn" | "probable crop" = "probable crop", why: string;
        if (cornLen < o.cornShare * allLen) why = `the photographs holding it mostly call it a planted row, crop not confirmed (${corn.size} of ${seen.size} call it corn)`;
        else if (cov.size > 1 && repeat < o.minRepeat) why = `held by ${seen.size} of the ${cov.size} photographs covering it`;
        else { identity = "corn"; why = `${corn.size} of ${seen.size} photographs call it corn; ${seen.size} of ${cov.size} covering it hold it`; }
        rows.push({ id: rows.length + 1, identity, lineEN, line: lineEN.map(([e, n]) => ll(e, n)), lengthM: Math.round(len * 100) / 100, seenBy: seen.size, cornBy: corn.size, coveredBy: cov.size, why });
      }
    }
  }
  const fieldRowAt = (e: number, n: number): FieldRow | null => {
    if (!pitchM) return null;
    const [a, c] = toAC(e, n);
    let best: FieldRow | null = null, bd = Infinity;
    for (const r of rows) { const ac = r.lineEN.map(([x, y]) => toAC(x, y)); if (a < ac[0][0] - 0.5 || a > ac[ac.length - 1][0] + 0.5) continue; const d = Math.min(...ac.map(q => Math.abs(q[1] - c) + 0.01 * Math.abs(q[0] - a))); if (d < bd) { bd = d; best = r; } }
    return best && bd <= o.sameRowShare * pitchM ? best : null;
  };

  // Weeds: every judged green patch is a sighting; Direct's reconcile joins the sightings of one patch.
  const obs: Observation[] = [];
  for (const r of used) {
    const f = frames.get(r.name)!;
    r.patches.forEach((p, i) => {
      const ring = p.hull.map(([x, y]) => ground(f, x * r.scale, y * r.scale)).filter((q): q is [number, number] => !!q);
      let area = 0; for (let k = 0; k < ring.length; k++) { const [x1, y1] = ring[k], [x2, y2] = ring[(k + 1) % ring.length]; area += x1 * y2 - x2 * y1; }
      area = Math.abs(area) / 2;
      obs.push({ frame: r.name, id: i, u: p.x * r.scale, v: p.y * r.scale, sizeM: 2 * Math.sqrt(Math.max(area, 1e-6) / Math.PI), areaM2: area, touchesEdge: p.touchesEdge, data: { poly: p.hull.map(([x, y]) => [x * r.scale, y * r.scale]), verdict: p.verdict } });
    });
  }
  const objects = obs.length ? reconcile(obs, new Map(used.map(r => [r.name, frames.get(r.name)!])), { linkBy: "overlap", absorb: true, searchM: o.weedSearchM }) : [];
  const weeds: FieldWeed[] = objects.map((ob, i) => {
    const votes: Record<FieldWeedVerdict, number> = { "weed candidate": 0, "crop on a row": 0, "unknown vegetation": 0 };
    for (const m of ob.members) votes[(m.data?.verdict as FieldWeedVerdict) ?? "unknown vegetation"]++;
    const [e, n] = en(ob.lat, ob.lng), photos = [...new Set(ob.members.map(m => m.frame))];
    const needVotes = Math.min(o.minWeedVotes, ob.coveredBy);
    let verdict: FieldWeedVerdict, why: string;
    if (votes["crop on a row"] > 0 && votes["crop on a row"] >= votes["weed candidate"]) { verdict = "crop on a row"; why = `${votes["crop on a row"]} photograph(s) place it on a planted row's line`; }
    else if (votes["weed candidate"] >= needVotes && votes["weed candidate"] > votes["unknown vegetation"] + votes["crop on a row"] && ob.seenBy >= o.weedMinSeenShare * ob.coveredBy) { verdict = "weed candidate"; why = `a weed candidate in ${votes["weed candidate"]} of the ${ob.coveredBy} photographs covering it`; }
    else { verdict = "unknown vegetation"; why = votes["weed candidate"] ? `a weed candidate in only ${votes["weed candidate"]} of the ${ob.coveredBy} photographs covering it (${ob.seenBy} saw it at all)` : "no photograph calls it a weed candidate"; }
    return { id: i + 1, lat: ob.lat, lng: ob.lng, e, n, areaM2: Math.round(ob.areaM2 * 10000) / 10000, verdict, votes, seenBy: ob.seenBy, coveredBy: ob.coveredBy, photos, why };
  });

  // Gaps: reported stand gaps on their field rows, joined along, then checked in every photograph covering them.
  type G = { photo: string; row: FieldRow; a0: number; a1: number; c: number };
  const reported: G[] = [];
  for (const r of used) {
    const f = frames.get(r.name)!;
    for (const g of r.gaps) {
      if (g.verdict !== "stand gap") continue;
      const p = ground(f, g.x1 * r.scale, g.y1 * r.scale), q = ground(f, g.x2 * r.scale, g.y2 * r.scale);
      if (!p || !q) continue;
      const row = fieldRowAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      if (!row) continue;
      const A = toAC(p[0], p[1]), B = toAC(q[0], q[1]);
      reported.push({ photo: r.name, row, a0: Math.min(A[0], B[0]), a1: Math.max(A[0], B[0]), c: (A[1] + B[1]) / 2 });
    }
  }
  const groups: G[][] = [];
  for (const g of reported.sort((x, y) => x.row.id - y.row.id || x.a0 - y.a0)) {
    const hit = groups.find(gr => gr[0].row === g.row && gr.some(h => Math.min(h.a1, g.a1) - Math.max(h.a0, g.a0) >= o.gapOverlapShare * Math.min(h.a1 - h.a0, g.a1 - g.a0)));
    if (hit && !hit.some(h => h.photo === g.photo)) hit.push(g); else if (!hit) groups.push([g]);
  }
  const gaps: FieldGap[] = groups.map((gr, i) => {
    const a0 = median(gr.map(g => g.a0)), a1 = median(gr.map(g => g.a1)), c = median(gr.map(g => g.c));
    const aEN = fromAC(a0, c), bEN = fromAC(a1, c);
    const reportedBy = [...new Set(gr.map(g => g.photo))];
    // Every photograph covering the gap's middle: did it locate a plant inside, and does it hold a corn row there?
    const mid = fromAC((a0 + a1) / 2, c), cov = covering(mid[0], mid[1]);
    const plantSeenBy: string[] = [], cornHolders: string[] = [];
    for (const name of cov) {
      const r = used.find(x => x.name === name)!, f = frames.get(name)!;
      const tolPx = o.gapPlantTolM / (gsdOf.get(name)! * r.scale);
      const samples: [number, number][] = [];
      for (let t = 0.1; t <= 0.9001; t += 0.05) { const [e, n] = fromAC(a0 + (a1 - a0) * t, c), [la, lo] = ll(e, n), hp = groundToPixel(f, la, lo, f.ground.kind === "flat" ? f.ground.altM : (f.ground.altAt(la, lo) ?? f.pose.altM)); if (hp && hp.inside) samples.push([hp.u / r.scale, hp.v / r.scale]); }
      if (samples.length < 3) continue;
      if (r.plants.some(([x, y]) => samples.some(([u, v]) => Math.hypot(u - x, v - y) <= tolPx))) plantSeenBy.push(name);
      const holds = r.rows.some(row => row.identity === "corn" && samples.filter(([u, v]) => row.points.some(([x, y]) => Math.hypot(u - x, v - y) <= 0.15 * (pitchM ?? 0.76) / (gsdOf.get(name)! * r.scale))).length >= samples.length / 2);
      if (holds || reportedBy.includes(name)) cornHolders.push(name);
    }
    const notReportedBy = cornHolders.filter(n => !reportedBy.includes(n));
    let verdict: "stand gap" | "withheld" = "stand gap", why = `reported by ${reportedBy.length} of the ${cornHolders.length} photographs holding a corn row over it; no plant seen in it by any of the ${cov.length} covering it`;
    if (plantSeenBy.length) { verdict = "withheld"; why = `a plant located inside it in ${plantSeenBy.length} photograph(s)`; }
    else if (reportedBy.length < 0.5 * cornHolders.length) { verdict = "withheld"; why = `reported by only ${reportedBy.length} of the ${cornHolders.length} photographs holding a corn row over it`; }
    else if (gr[0].row.identity !== "corn") { verdict = "withheld"; why = "on a field row whose crop is not confirmed"; }
    return { id: i + 1, row: gr[0].row.id, aEN, bEN, a: ll(aEN[0], aEN[1]), b: ll(bEN[0], bEN[1]), lengthM: Math.round((a1 - a0) * 100) / 100, verdict, reportedBy, notReportedBy, plantSeenBy, why };
  });

  const cornRows = rows.filter(r => r.identity === "corn"), keptGaps = gaps.filter(g => g.verdict === "stand gap");
  notes.push("Review-only: rows, identities and candidate findings with the photographs behind each; nothing here decides a treatment.");
  return {
    version: CORN_FIELD_VERSION, origin, directionDeg, pitchM: pitchM ? Math.round(pitchM * 1000) / 1000 : null, rows, weeds, gaps,
    rowAgreementM: agreement.length ? Math.round(median(agreement) * 1000) / 1000 : null,
    summary: {
      photographs: used.length, cornRows: cornRows.length, probableRows: rows.length - cornRows.length, cornRowLengthM: Math.round(cornRows.reduce((s, r) => s + r.lengthM, 0) * 10) / 10,
      weeds: weeds.filter(w => w.verdict === "weed candidate").length, weedsWithheld: weeds.filter(w => w.verdict === "unknown vegetation").length, cropOnRow: weeds.filter(w => w.verdict === "crop on a row").length,
      gaps: keptGaps.length, gapLengthM: Math.round(keptGaps.reduce((s, g) => s + g.lengthM, 0) * 100) / 100, gapsWithheld: gaps.length - keptGaps.length,
      perPhoto: { weedCandidates: used.reduce((s, r) => s + r.patches.filter(p => p.verdict === "weed candidate").length, 0), standGaps: used.reduce((s, r) => s + r.gaps.filter(g => g.verdict === "stand gap").length, 0), rows: used.reduce((s, r) => s + r.rows.length, 0) },
      ms: Date.now() - t0,
    },
    notes,
  };
}
