// The analysis record of a corn Field Twin (src/lib/fieldTwin/analysis.ts): what it holds, that writing it down and
// reading it back gives the field's combination again exactly, that making it changes nothing it is made from, that it
// holds no pixels and no digest of the photographs, and (on the real test flight, when it is on this computer) that a
// build asked for one produces the same twin as a build that is not.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { nodeCodec, nodePhoto } from "../../scripts/directGeoref/nodePhotos";
import { TWIN_ANALYSIS_ENABLED, TWIN_ANALYSIS_FILE, TWIN_ANALYSIS_FORMAT, type AnalysisInputs, analysisBytes, buildTwinAnalysis, framesFromAnalysis, parseTwinAnalysis, reproduceCornField } from "@/lib/fieldTwin/analysis";
import { buildFieldTwin } from "@/lib/fieldTwin/build/pipeline";
import { type CornFieldResult, type CornPhotoRead, cornField } from "@/lib/fieldTwin/cornField";
import { bundleFileNames, missingFiles } from "@/lib/fieldTwin/store";
import { parseTwin, type TwinBundle } from "@/lib/fieldTwin/types";
import { IDENTITY, enuFromCamera, groundToPixel, mulM, type GeorefFrame, type M3 } from "@/lib/directGeoref/projection";
import { fromEnu } from "@/lib/sourceFrames/odm";
import { CORN_TWIN } from "./fixtures/cornTwin";

// ---- a known field under three overlapping cameras (as cornField.test.ts) ---------------------------------------
const ORIGIN = { lat: 40, lng: -90, altM: 0 };
const PITCH = 0.762;
const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, { rotation: IDENTITY, basis: "t" });
const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
const NADIR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
function camera(name: string, e: number, n: number): GeorefFrame {
  const p = fromEnu([e, n, 0], ORIGIN);
  return {
    name,
    intrinsics: { width: 4000, height: 3000, fx: 2000, fy: 2000, cx: 2000, cy: 1500, distortion: null, basis: "test" },
    pose: { lat: p.lat, lng: p.lng, altM: 10, datum: "test", attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "test" },
    ground: { kind: "flat", altM: 0, datum: "test", basis: "test" },
  };
}
const px = (f: GeorefFrame, e: number, n: number) => { const p = fromEnu([e, n, 0], ORIGIN), h = groundToPixel(f, p.lat, p.lng, 0)!; return h.inside ? ([h.u, h.v] as [number, number]) : null; };
const ROWS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const inGap = (k: number, n: number) => k === 2 && n > 1.0 && n < 2.0;
function readOf(f: GeorefFrame, extra: Partial<CornPhotoRead> = {}): CornPhotoRead {
  const rows: CornPhotoRead["rows"] = [], plants: [number, number][] = [];
  for (const k of ROWS) {
    const pts: [number, number][] = [];
    for (let n = -20; n <= 30; n += 0.5) { const q = px(f, k * PITCH, n); if (q) pts.push(q); }
    if (pts.length >= 2) rows.push({ points: pts, identity: "corn", evidence: "both reads agree", confidence: "high" });
    for (let n = -20; n <= 30; n += 0.2) { if (inGap(k, n)) continue; const q = px(f, k * PITCH, n); if (q) plants.push(q); }
  }
  return { name: f.name, scale: 1, rows, patches: [], gaps: [], plants, ...extra };
}
const patch = (f: GeorefFrame, e: number, n: number, verdict: CornPhotoRead["patches"][number]["verdict"]) => { const c = px(f, e, n)!; const r = 12; return { x: c[0], y: c[1], hull: [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]] as [number, number][], touchesEdge: false, verdict }; };
const gap = (f: GeorefFrame, k: number, n1: number, n2: number) => { const a = px(f, k * PITCH, n1)!, b = px(f, k * PITCH, n2)!; return { x1: a[0], y1: a[1], x2: b[0], y2: b[1], verdict: "stand gap" as const }; };

const A = camera("A", 0, -2), B = camera("B", 0, 2), C = camera("C", 0, 6);
const frames = new Map([A, B, C].map(f => [f.name, f]));
const weed = { e: 0.5 * PITCH, n: 2.5 }, fake = { e: 1.5 * PITCH, n: 3.2 }, onRow = { e: 3 * PITCH, n: 1.5 };
const reads = [
  readOf(A, { patches: [patch(A, weed.e, weed.n, "weed candidate"), patch(A, onRow.e, onRow.n, "weed candidate")], gaps: [gap(A, 2, 1.0, 2.0)] }),
  readOf(B, { patches: [patch(B, weed.e, weed.n, "weed candidate"), patch(B, fake.e, fake.n, "weed candidate"), patch(B, onRow.e, onRow.n, "crop on a row")], gaps: [gap(B, 2, 1.0, 2.0), gap(B, -3, 3.0, 4.0)] }),
  readOf(C, { patches: [patch(C, weed.e, weed.n, "weed candidate")], gaps: [gap(C, 2, 1.0, 2.0)] }),
];
const field = cornField(reads, frames);

/** The twin's corn section as the bundle writes it from a field: weeds some photograph called a weed, numbered from 1; gaps by their own ids. */
function twinOf(f: CornFieldResult): TwinBundle {
  const t = JSON.parse(JSON.stringify(CORN_TWIN)) as TwinBundle;
  const ll = (v: number) => +v.toFixed(8);
  t.corn!.weeds = f.weeds.filter(w => w.votes["weed candidate"] > 0).map((w, i) => ({ ...t.corn!.weeds[0], id: i + 1, lat: ll(w.lat), lng: ll(w.lng), evidence: [] }));
  t.corn!.gaps = f.gaps.map(g => ({ ...t.corn!.gaps[0], id: g.id, evidence: [] }));
  return t;
}
const twin = twinOf(field);
const inputs = (over: Partial<AnalysisInputs> = {}): AnalysisInputs => ({
  twin, reads, field, frames,
  crops: [{ atlas: 0, x: 112, y: 0, photo: "B", x0: 1900, y0: 1400, size: 60 }],
  photographs: new Map([["A", { bytes: 8_100_000, capturedAt: "2026:06:01 10:00:00" }], ["B", { bytes: 8_200_000, capturedAt: "2026:06:01 10:00:02" }]]),
  ...over,
});
const stripMs = (f: CornFieldResult) => ({ ...f, summary: { ...f.summary, ms: 0 } });
/** Written down as the app stores it and read back: JSON, gzip, gunzip, JSON. */
const stored = (bytes: Uint8Array) => JSON.parse(gunzipSync(gzipSync(bytes)).toString("utf8"));

describe("the analysis record of a corn twin", () => {
  it("is off as shipped, and is not one of the twin's files", () => {
    expect(TWIN_ANALYSIS_ENABLED).toBe(false);
    expect(TWIN_ANALYSIS_FILE).toBe("analysis.json.gz");
    expect(bundleFileNames(CORN_TWIN)).toEqual(["twin.json", "atlas-0.jpg"]);
    // A twin with its own files is complete whether or not a record lies beside it.
    expect(missingFiles(CORN_TWIN, ["twin.json", "atlas-0.jpg"])).toEqual([]);
    expect(missingFiles(CORN_TWIN, ["twin.json", "atlas-0.jpg", TWIN_ANALYSIS_FILE])).toEqual([]);
    // The record's file name is not one the twin format accepts as an atlas, so no twin can name it.
    const t = JSON.parse(JSON.stringify(CORN_TWIN)) as TwinBundle;
    t.atlases = [{ file: TWIN_ANALYSIS_FILE, width: 1, height: 1 }];
    expect(parseTwin(t).ok).toBe(false);
  });

  it("holds the reads, the cameras, each finding's place in each photograph and each crop's source, under the twin's own ids", () => {
    const a = buildTwinAnalysis(inputs())!;
    expect(a).toMatchObject({ format: TWIN_ANALYSIS_FORMAT, twinId: twin.id, builtAt: twin.builtAt, crop: "corn", notes: [] });
    expect(a.engine).toEqual({ cornV1: 1, cornField: 2, twinEngine: twin.corn!.engine });
    expect(a.reads).toEqual(reads);
    expect(a.frames.map(f => f.name)).toEqual(["A", "B", "C"]);
    expect(a.frames[0].ground).toEqual({ altM: 0, datum: "test", basis: "test" });
    // Three weed observations in the twin (one confirmed, one unrepeated, one a photograph calls the crop), each with
    // every photograph's sighting in that photograph's own pixels.
    expect(a.sightings.weeds.map(w => w.id)).toEqual(twin.corn!.weeds.map(w => w.id));
    const confirmed = a.sightings.weeds.find(w => w.sightings.length === 3)!;
    expect(confirmed.sightings.map(s => s.photo).sort()).toEqual(["A", "B", "C"]);
    for (const s of confirmed.sightings) { const want = px(frames.get(s.photo)!, weed.e, weed.n)!; expect(Math.hypot(s.u - want[0], s.v - want[1])).toBeLessThan(1); expect(s.poly).toHaveLength(4); }
    expect(a.sightings.gaps.map(g => g.id)).toEqual(field.gaps.map(g => g.id));
    expect(a.sightings.gaps[0].sightings[0]).toMatchObject({ photo: expect.any(String), u1: expect.any(Number), v2: expect.any(Number) });
    expect(a.crops).toEqual([{ atlas: 0, x: 112, y: 0, photo: "B", x0: 1900, y0: 1400, size: 60 }]);
  });

  it("names each photograph by name, size and date only: no pixels, no digest", () => {
    const a = buildTwinAnalysis(inputs())!;
    expect(a.photographs).toEqual([
      { name: "A", bytes: 8_100_000, width: 4000, height: 3000, capturedAt: "2026:06:01 10:00:00" },
      { name: "B", bytes: 8_200_000, width: 4000, height: 3000, capturedAt: "2026:06:01 10:00:02" },
      { name: "C", bytes: null, width: 4000, height: 3000, capturedAt: null },
    ]);
    const keys = new Set<string>();
    const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(JSON.parse(new TextDecoder().decode(analysisBytes(a))));
    expect([...keys].filter(k => /^sha\d*$|sha256|digest|hash|rgba|pixel|jpeg|base64|blob|^data$/i.test(k))).toEqual([]);
    // Small: this field's record is a few tens of kilobytes compressed.
    expect(gzipSync(analysisBytes(a)).length).toBeLessThan(100_000);
  });

  it("stored and read back, gives the field's combination again exactly", () => {
    const a = buildTwinAnalysis(inputs())!;
    const parsed = parseTwinAnalysis(stored(analysisBytes(a)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(framesFromAnalysis(parsed.analysis)).toEqual(frames);
    const again = reproduceCornField(parsed.analysis);
    expect(JSON.stringify(stripMs(again))).toBe(JSON.stringify(stripMs(field)));
    // And the twin's own findings follow from it: the same weed observations in the same places.
    const ll = (v: number) => +v.toFixed(8);
    expect(again.weeds.filter(w => w.votes["weed candidate"] > 0).map(w => [ll(w.lat), ll(w.lng)])).toEqual(twin.corn!.weeds.map(w => [w.lat, w.lng]));
  });

  it("changes nothing it is made from", () => {
    const before = [JSON.stringify(twin), JSON.stringify(reads), JSON.stringify(field), JSON.stringify([...frames])];
    const a = buildTwinAnalysis(inputs())!;
    analysisBytes(a); reproduceCornField(a);
    expect([JSON.stringify(twin), JSON.stringify(reads), JSON.stringify(field), JSON.stringify([...frames])]).toEqual(before);
    expect(parseTwin(JSON.parse(JSON.stringify(twin))).ok).toBe(true);
  });

  it("is not made for a twin without a corn section, or over a ground that is not the flat plane", () => {
    const orchard = JSON.parse(JSON.stringify(CORN_TWIN)) as TwinBundle;
    delete orchard.corn;
    expect(buildTwinAnalysis(inputs({ twin: orchard }))).toBeNull();
    const surface = new Map(frames);
    surface.set("B", { ...B, ground: { kind: "surface", altAt: () => 0, datum: "t", basis: "t" } });
    expect(buildTwinAnalysis(inputs({ frames: surface }))).toBeNull();
  });

  it("leaves the sightings out, and says so, when the twin's findings cannot be matched to the field's", () => {
    const moved = JSON.parse(JSON.stringify(twin)) as TwinBundle;
    moved.corn!.weeds[0].lat += 0.0001;
    moved.corn!.gaps.pop();
    const a = buildTwinAnalysis(inputs({ twin: moved }))!;
    expect(a.sightings).toEqual({ weeds: [], gaps: [] });
    expect(a.notes).toHaveLength(2);
    // The reads and cameras are still there: the field can still be combined again.
    expect(JSON.stringify(stripMs(reproduceCornField(a)))).toBe(JSON.stringify(stripMs(field)));
  });

  it("keeps only the photographs the field was combined from", () => {
    const two = new Map([A, B].map(f => [f.name, f]));
    const a = buildTwinAnalysis(inputs({ frames: two, field: cornField(reads, two), twin: twinOf(cornField(reads, two)) }))!;
    expect(a.reads.map(r => r.name)).toEqual(["A", "B"]);
    expect(a.frames).toHaveLength(2);
    expect(parseTwinAnalysis(stored(analysisBytes(a))).ok).toBe(true);
  });

  it("refuses a file that is not a record, with the reason", () => {
    const good = () => stored(analysisBytes(buildTwinAnalysis(inputs())!));
    const bad = (patch: (a: Record<string, unknown>) => void) => { const a = good(); patch(a); const r = parseTwinAnalysis(a); return "reason" in r ? r.reason : null; };
    expect(parseTwinAnalysis(null)).toEqual({ ok: false, reason: "not a JSON object" });
    expect(parseTwinAnalysis(JSON.parse(JSON.stringify(CORN_TWIN)))).toMatchObject({ ok: false, reason: expect.stringMatching(/format is "swardus-field-twin-v1"/) });
    expect(bad(a => { a.crop = "orchard"; })).toMatch(/not a corn record/);
    expect(bad(a => { delete a.reads; })).toMatch(/reads is not a list/);
    expect(bad(a => { (a.frames as { pose: { lat: unknown } }[])[0].pose.lat = "40"; })).toMatch(/camera A has a number missing/);
    expect(bad(a => { (a.frames as unknown[]).pop(); })).toMatch(/the read of C has no camera/);
    expect(bad(a => { delete (a.engine as Record<string, unknown>).cornField; })).toMatch(/no engine versions/);
  });
});

const FLIGHT = "D:/swardus-research/cornflight/Day023_Corn1-n40";
const haveFlight = existsSync(FLIGHT) && readdirSync(FLIGHT).filter(f => /\.jpe?g$/i.test(f)).length >= 40;

describe.skipIf(!haveFlight)("the real build on the UAV3DCrop corn test flight, with and without the record", () => {
  it("builds the same twin either way, the record apart from the twin's files, and the record gives the twin's corn again", { timeout: 900_000 }, async () => {
    const files = readdirSync(FLIGHT).filter(f => /\.jpe?g$/i.test(f)).sort();
    const pick = ["746.JPG", "745.JPG", "747.JPG", "744.JPG"].filter(f => files.includes(f));
    const build = (analysis: boolean) => buildFieldTwin(pick.map(f => nodePhoto(join(FLIGHT, f))), { name: "corn test", id: "corn-test", crop: "corn", detector: null, weedTier: "none", usePreview: false, ...(analysis ? { analysis: true } : {}) }, nodeCodec);
    const plain = await build(false), withRecord = await build(true);
    // The twin: identical but for the moment it was built.
    const same = (t: TwinBundle) => JSON.stringify({ ...t, builtAt: "" });
    expect(same(withRecord.twin)).toBe(same(plain.twin));
    expect([...withRecord.files.keys()]).toEqual([...plain.files.keys()]);
    expect([...withRecord.files.keys()].some(k => /analysis/.test(k))).toBe(false);
    for (const [k, v] of plain.files) if (k !== "twin.json") expect(Buffer.from(withRecord.files.get(k) as Uint8Array).equals(Buffer.from(v as Uint8Array))).toBe(true);
    expect(plain.analysis).toBeNull();

    const parsed = parseTwinAnalysis(stored(withRecord.analysis!));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const a = parsed.analysis, corn = withRecord.twin.corn!;
    expect(a.twinId).toBe("corn-test");
    expect(a.reads.map(r => r.name)).toEqual(pick.map(f => f.replace(/\.JPG$/, "")).sort());
    expect(a.notes).toEqual([]);
    // Every crop the twin shows has its source in the record, by its atlas cell, in a photograph the record holds.
    const cells = new Set(a.crops.map(c => `${c.atlas}:${c.x}:${c.y}`));
    const evidence = [...corn.weeds, ...corn.gaps].flatMap(o => o.evidence);
    expect(evidence.length).toBe(a.crops.length);
    for (const e of evidence) expect(cells.has(`${e.atlas}:${e.x}:${e.y}`)).toBe(true);
    for (const c of a.crops) { const f = a.frames.find(x => x.name === c.photo)!; expect(c.x0 >= 0 && c.y0 >= 0 && c.x0 + c.size <= f.intrinsics.width && c.y0 + c.size <= f.intrinsics.height).toBe(true); }
    // The field combined again from the record is the twin's corn section: rows, weed observations and gaps.
    const again = reproduceCornField(a), ll = (v: number) => +v.toFixed(8);
    expect(again.rows.map(r => r.line.map(([p, q]) => [ll(p), ll(q)]))).toEqual(corn.rows.map(r => r.line));
    expect(again.rows.map(r => (r.identity === "corn" ? "corn" : "unconfirmed"))).toEqual(corn.rows.map(r => r.status));
    expect(again.weeds.filter(w => w.votes["weed candidate"] > 0).map(w => [ll(w.lat), ll(w.lng), w.verdict === "weed candidate" ? "confirmed" : w.verdict === "crop on a row" ? "contested" : "unconfirmed"])).toEqual(corn.weeds.map(w => [w.lat, w.lng, w.status]));
    expect(again.gaps.map(g => [g.id, g.row, g.lengthM, g.verdict === "stand gap" ? "confirmed" : "withheld"])).toEqual(corn.gaps.map(g => [g.id, g.rowId, g.lengthM, g.status]));
    expect(a.sightings.weeds.map(w => w.id)).toEqual(corn.weeds.map(w => w.id));
  });
});
