// @vitest-environment node
// The Layer 2 benchmark on a scan, with every network edge faked: the scan
// row, the archive, the frame list, the originals, the chips, the detector.
// What is real: the ODM reconstruction of Testing Field 2 (the fixture), the
// app's own projection, selection and crop geometry, and the pixel codecs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type FrameIndex, framesManifestPath, indexManifest, lookupOriginal, odmFilenameFor } from "@/lib/sourceFrames/manifest";
import { groundAltitudeFromOdm, parseOdmOutputs } from "@/lib/sourceFrames/odm";
import { type StorageClient, loadScanSourcesWith, memberKey, reconstructionPrefix } from "@/lib/sourceFrames/sources";
import { spotSources } from "@/lib/sourceFrames/spot";
import { decodeImage, encodeJpeg, encodePng, sha256 } from "../../scripts/bench/images";
import { renderReport } from "@/lib/sourceFrames/benchReport";
import { type ModelResult, type ModelRunner, SKIPPED, createRoboflowRunner, normalizeRoboflow } from "../../scripts/bench/roboflow";
import {
  type BenchDeps, type DbClient, type ObservationLite, type ScanTask,
  candidateFromObservation, pointCandidate, resolveTask, runBench, writeResults,
} from "../../scripts/bench/scanBench";
import { parseArgs, parsePoint } from "../../scripts/bench/cli";

// ---------------------------------------------------------------------------
// The real reconstruction, and a point several photographs hold
// ---------------------------------------------------------------------------

const FIX = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const fixture = (f: string) => JSON.parse(readFileSync(join(FIX, f), "utf-8"));
const files = { cameras: fixture("cameras.json"), shots: fixture("shots.geojson"), images: fixture("images.json"), stats: fixture("stats.json") };
const set = parseOdmOutputs({ camerasJson: files.cameras, shotsGeojson: files.shots, imagesJson: files.images });
const groundAltM = groundAltitudeFromOdm(set, files.stats.odm_processing_statistics.average_gsd)!;
const CENTRE = { lat: 54.17259, lng: 12.30625 };
const FAR = { lat: 54.0, lng: 12.0 };
/** The frame the app itself would pick for a 3 m square at the centre. */
const best = spotSources({ set, stats: files.stats, groundAltM, frames: null, reconstruction: "stored" }, pointCandidate({ ...CENTRE, spanM: 3 })).views[0];

const USER = "user-1", ODM = "dd0f6314-aaaa-bbbb-cccc-000000000000", TASK_ID = "11111111-2222-3333-4444-555555555555";
const SERVICE_KEY = "service-role-key-abcdefghijklmnop", RF_KEY = "roboflow-key-0123456789";

const task: ScanTask = { id: TASK_ID, user_id: USER, field_id: "field-1", odm_uuid: ODM, status: "completed", output_path: `${USER}/odm/${ODM}/all.zip`, image_count: 180, created_at: "2026-10-01T00:00:00Z" };

/** A camera-sized "original": wider than the 2,400 px frame ODM saw, with a gradient so it is a real JPEG. */
function syntheticOriginal(width = 2736, height = 1824): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = (x * 255) / width; data[i + 1] = 120; data[i + 2] = (y * 255) / height; data[i + 3] = 255;
  }
  return encodeJpeg({ width, height, data }, 80);
}
const ORIGINAL = syntheticOriginal();
const CHIP = encodePng({ width: 48, height: 48, data: new Uint8Array(48 * 48 * 4).fill(90) });

// ---------------------------------------------------------------------------
// A Supabase client that records everything it is asked
// ---------------------------------------------------------------------------

type Store = Record<string, Uint8Array | string>;
type Fake = DbClient & StorageClient & { ops: string[]; downloads: string[]; uploads: string[] };

function fakeClient(opts: { tasks?: ScanTask[]; observations?: ObservationLite[]; objects?: Store; failDownload?: string[] } = {}): Fake {
  const tasks = opts.tasks ?? [task], observations = opts.observations ?? [], objects = opts.objects ?? {};
  const ops: string[] = [], downloads: string[] = [], uploads: string[] = [];
  const bytesOf = (v: Uint8Array | string) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
  const query = (table: string) => {
    let rows: Record<string, unknown>[] = table === "odm_tasks" ? [...tasks] : table === "weed_observations" ? [...observations] : [];
    const q = {
      select(_cols: string) { ops.push(`select ${table}`); return q; },
      insert() { ops.push(`insert ${table}`); return q; },
      update() { ops.push(`update ${table}`); return q; },
      upsert() { ops.push(`upsert ${table}`); return q; },
      delete() { ops.push(`delete ${table}`); return q; },
      eq(col: string, v: unknown) { rows = rows.filter(r => r[col] === v); return q; },
      ilike(col: string, v: string) { const p = v.replace(/%$/, "").toLowerCase(); rows = rows.filter(r => String(r[col] ?? "").toLowerCase().startsWith(p)); return q; },
      order(col: string, o: { ascending: boolean }) { rows.sort((a, b) => ((a[col] as number) - (b[col] as number)) * (o.ascending ? 1 : -1)); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then(res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
    };
    return q;
  };
  const storage = {
    from(bucket: string) {
      return {
        async list(prefix: string) {
          const out = Object.keys(objects).filter(k => k.startsWith(`${bucket}/${prefix}/`)).map(k => k.slice(bucket.length + prefix.length + 2)).filter(n => !n.includes("/"));
          return { data: out.map(name => ({ name, metadata: { size: bytesOf(objects[`${bucket}/${prefix}/${name}`]).length } })), error: null };
        },
        async download(path: string) {
          downloads.push(`${bucket}/${path}`);
          if (opts.failDownload?.includes(path)) return { data: null, error: { message: "boom" } };
          const v = objects[`${bucket}/${path}`];
          return v === undefined ? { data: null, error: { message: "Object not found" } } : { data: new Blob([bytesOf(v)]), error: null };
        },
        async createSignedUrl(path: string) {
          return objects[`${bucket}/${path}`] === undefined ? { data: null, error: { message: "Object not found" } } : { data: { signedUrl: `https://signed.test/${bucket}/${path}?token=x` }, error: null };
        },
        async upload(path: string, body: Blob | string | Uint8Array) {
          uploads.push(`${bucket}/${path}`);
          objects[`${bucket}/${path}`] = typeof body === "string" ? body : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body;
          return { data: { path }, error: null };
        },
      };
    },
  };
  return { from: query as unknown as DbClient["from"], storage: storage as unknown as StorageClient["storage"], ops, downloads, uploads };
}

/** Range requests over the fake signed URLs, the way storage serves them. */
function fakeFetch(objects: Store): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const m = /^https:\/\/signed\.test\/([^?]+)/.exec(u);
    if (!m) return new Response("not found", { status: 404 });
    const v = objects[m[1]];
    if (v === undefined) return new Response("not found", { status: 404 });
    const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
    const range = /bytes=(\d+)-(\d+)/.exec(String((init?.headers as Record<string, string>)?.Range ?? ""));
    if (!range) return new Response(bytes, { status: 200 });
    const s = Number(range[1]), e = Math.min(Number(range[2]), bytes.length - 1);
    return new Response(bytes.subarray(s, e + 1), { status: 206, headers: { "Content-Range": `bytes ${s}-${e}/${bytes.length}` } });
  }) as typeof fetch;
}

const storedReconstruction = (): Store => Object.fromEntries([
  ["cameras.json", files.cameras], ["odm_report/shots.geojson", files.shots], ["images.json", files.images], ["odm_report/stats.json", files.stats],
].map(([name, json]) => [`scans/${reconstructionPrefix(USER, ODM)}/${memberKey(name as string)}`, JSON.stringify(json)]));

const manifestFor = (names: string[]): Store => ({
  [`scans/${framesManifestPath(USER, ODM)}`]: JSON.stringify(names.map(n => ({ filename: n, path: `${USER}/${ODM}/frames/${n}`, bytes: ORIGINAL.length, type: "image/jpeg", lastModified: 1 }))),
  ...Object.fromEntries(names.map(n => [`scans/${USER}/${ODM}/frames/${n}`, ORIGINAL])),
});

function fakeModel(byMime: Partial<Record<"image/jpeg" | "image/png", ModelResult>> = {}): ModelRunner & { seen: { bytes: number; mime: string; sha: string }[] } {
  const seen: { bytes: number; mime: string; sha: string }[] = [];
  const two: ModelResult = { ...SKIPPED, status: "SUCCESS", modelId: "fake/1", count: 2, maxConfidence: 0.99, meanConfidence: 0.9, detections: [
    { x: 100, y: 100, width: 40, height: 40, confidence: 0.99, klass: "weed" }, { x: 200, y: 150, width: 30, height: 30, confidence: 0.81, klass: "weed" },
  ] };
  const none: ModelResult = { ...SKIPPED, status: "SUCCESS_NO_DETECTIONS", modelId: "fake/1" };
  return {
    id: "fake/1", seen,
    describe: () => ({ provider: "fake" }),
    async detect(image, mime) { seen.push({ bytes: image.length, mime, sha: sha256(image) }); return byMime[mime] ?? (mime === "image/jpeg" ? two : none); },
  };
}

/** A stored row, with the scan_id column the real query filters on. */
const observation = (over: Partial<ObservationLite> = {}): ObservationLite => ({
  scan_id: TASK_ID,
  id: "row-1", candidate_id: "spot-1", lat: CENTRE.lat, lng: CENTRE.lng, kind: "field outlier", score: 0.7,
  geometry: null, area_m2: 1.2, class: null, features: { equivDiameterM: 0.9 },
  chip_path: `${USER}/${TASK_ID}/spot-1.png`, chip_gsd_m: 0.087, chip_span_m: 3.6,
  verdict: "weed", verdict_source: "operator", finding_class: "vegetation", species: "lambsquarters",
  prediction: { pWeed: 0.9, pCrop: 0.05, pOther: 0.05, modelVersion: "weed-v1" }, model_version: "weed-v1", ...over,
} as ObservationLite & { scan_id: string });

const tmpRoots: string[] = [];
const outDir = () => { const d = mkdtempSync(join(tmpdir(), "swathwise-bench-")); tmpRoots.push(d); return d; };
afterAll(() => { for (const d of tmpRoots) rmSync(d, { recursive: true, force: true }); });

const deps = (client: Fake | null, over: Partial<BenchDeps> = {}): BenchDeps => ({
  db: client, storage: client, fetchImpl: fakeFetch({}), model: fakeModel(), log: () => {}, now: () => "2026-10-03T00:00:00Z", ...over,
});

// ---------------------------------------------------------------------------
// The manifest contract
// ---------------------------------------------------------------------------

describe("the frame list maps ODM's filename to the kept original", () => {
  const frames: FrameIndex = indexManifest([
    { filename: "DJI_0098.JPG", path: "u/s/frames/DJI_0098.JPG", bytes: 1, type: "image/jpeg", lastModified: 0 },
    { filename: "DJI_0099.png", path: "u/s/frames/DJI_0099.png", bytes: 1, type: "image/png", lastModified: 0 },
    { filename: "junk" }, 42, null,
  ])!;

  it("exact name first, then the name ODM gave a re-encoded PNG; never a guess", () => {
    expect(lookupOriginal(frames, "DJI_0098.JPG")).toMatchObject({ ok: true, matchedBy: "filename", entry: { path: "u/s/frames/DJI_0098.JPG" } });
    expect(lookupOriginal(frames, "DJI_0099.jpg")).toMatchObject({ ok: true, matchedBy: "odm-rename", entry: { path: "u/s/frames/DJI_0099.png" } });
    expect(lookupOriginal(frames, "DJI_0099.png")).toMatchObject({ ok: true, matchedBy: "filename" });
    expect(lookupOriginal(frames, "DJI_0100.JPG")).toMatchObject({ ok: false, status: "NO_NATIVE_SOURCE_FRAME", reason: expect.stringContaining("not in the frame list (2 kept)") });
    // Storage keys are case sensitive and so is the lookup: a near miss is a miss.
    expect(lookupOriginal(frames, "DJI_0098.jpg")).toMatchObject({ ok: false, status: "NO_NATIVE_SOURCE_FRAME" });
    expect(Object.keys(frames)).toEqual(["DJI_0098.JPG", "DJI_0099.png"]);
  });

  it("a scan with no frame list says so, distinct from a frame that is missing", () => {
    expect(lookupOriginal(null, "DJI_0098.JPG")).toMatchObject({ ok: false, status: "NO_MANIFEST" });
    expect(indexManifest({ not: "a list" })).toBeNull();
  });

  it("uses the uploader's own rename rule", () => {
    expect(odmFilenameFor("a.PNG")).toBe("a.jpg");
    expect(odmFilenameFor("a.tiff")).toBe("a.jpg");
    expect(odmFilenameFor("a.JPG")).toBe("a.JPG");
    expect(odmFilenameFor("a.jpeg")).toBe("a.jpeg");
  });
});

// ---------------------------------------------------------------------------
// Scan lookup and the reconstruction
// ---------------------------------------------------------------------------

describe("finding the scan", () => {
  const other: ScanTask = { ...task, id: "99999999-2222-3333-4444-555555555555", odm_uuid: "dd0f9999-0000-0000-0000-000000000000" };

  it("by odm_tasks.id, by odm_uuid, or by an unambiguous uuid prefix; nothing else", async () => {
    const c = fakeClient({ tasks: [task, other] });
    expect((await resolveTask(c, TASK_ID))?.id).toBe(TASK_ID);
    expect((await resolveTask(c, ODM))?.id).toBe(TASK_ID);
    expect((await resolveTask(c, "dd0f6314"))?.id).toBe(TASK_ID);
    expect(await resolveTask(c, "nope")).toBeNull();
    await expect(resolveTask(c, "dd0f")).rejects.toThrow(/matches 2 scans/);
    expect(c.ops.every(o => o.startsWith("select"))).toBe(true);
  });
});

describe("the reconstruction and the frame list, from storage", () => {
  it("reads the four stored members and the manifest when they exist", async () => {
    const objects = { ...storedReconstruction(), ...manifestFor([best.filename]) };
    const c = fakeClient({ objects });
    const s = await loadScanSourcesWith(c, { userId: USER, odmUuid: ODM, outputPath: task.output_path }, { fetchImpl: fakeFetch(objects) });
    expect(s.reconstruction).toBe("stored");
    expect(s.set?.shots.length).toBe(180);
    expect(s.groundAltM).toBeCloseTo(groundAltM, 6);
    expect(Object.keys(s.frames!)).toEqual([best.filename]);
    expect(c.uploads).toEqual([]);
  });

  it("otherwise range-reads them out of the mirrored archive and stores them for next time", async () => {
    const enc = new TextEncoder();
    const archive = zipSync({
      "odm_orthophoto/odm_orthophoto.tif": [new Uint8Array(300_000).fill(1), { level: 0 }],
      "cameras.json": [enc.encode(JSON.stringify(files.cameras)), { level: 6 }],
      "odm_report/shots.geojson": [enc.encode(JSON.stringify(files.shots)), { level: 6 }],
      "images.json": [enc.encode(JSON.stringify(files.images)), { level: 6 }],
      "odm_report/stats.json": [enc.encode(JSON.stringify(files.stats)), { level: 0 }],
    });
    const objects: Store = { [`scans/${task.output_path}`]: archive };
    const c = fakeClient({ objects });
    const s = await loadScanSourcesWith(c, { userId: USER, odmUuid: ODM, outputPath: task.output_path }, { fetchImpl: fakeFetch(objects) });
    expect(s.reconstruction).toBe("extracted");
    expect(s.set?.shots.length).toBe(180);
    expect(s.frames).toBeNull();
    expect(c.uploads.sort()).toEqual(["cameras.json", "images.json", "odm_report__shots.geojson", "odm_report__stats.json"].map(n => `scans/${reconstructionPrefix(USER, ODM)}/${n}`).sort());
    // The archive itself was never downloaded whole.
    expect(c.downloads.some(d => d.endsWith("all.zip"))).toBe(false);
  });

  it("says none when there is no archive and no stored reconstruction", async () => {
    const c = fakeClient({ objects: {} });
    const s = await loadScanSourcesWith(c, { userId: USER, odmUuid: ODM, outputPath: null }, { fetchImpl: fakeFetch({}), warn: () => {} });
    expect(s).toMatchObject({ reconstruction: "none", set: null, frames: null, groundAltM: null });
  });
});

// ---------------------------------------------------------------------------
// The benchmark on a scan
// ---------------------------------------------------------------------------

describe("the benchmark on a saved finding", () => {
  it("finds the best frame, reads its exact original through the manifest, cuts the native crop, scores both sides, writes the record and the page", async () => {
    const objects = { ...storedReconstruction(), ...manifestFor([best.filename]), [`weed-chips/${USER}/${TASK_ID}/spot-1.png`]: CHIP };
    const c = fakeClient({ observations: [observation()], objects });
    const model = fakeModel();
    const out = outDir();
    const run = await runBench({ scan: "dd0f6314", out }, deps(c, { fetchImpl: fakeFetch(objects), model }));

    expect(run.scan).toMatchObject({ taskId: TASK_ID, odmUuid: ODM, reconstruction: "stored", posedFrames: 180, framesKept: 1, originalsSource: "retained-original" });
    expect(run.findings).toHaveLength(1);
    const r = run.findings[0];
    expect(r.status).toBe("SUCCESS");
    expect(r.selectedFrame).toBe(best.filename);
    expect(r.candidateFrames).toBeGreaterThanOrEqual(3);
    expect(r.chosenFrames).toEqual([best.filename]);
    expect(r.coverage).toBe(1);
    expect(r.matchedBy).toBe("filename");

    // The exact bytes the manifest pointed at, and nothing else, were read as the original.
    expect(r.originalPath).toBe(`${USER}/${ODM}/frames/${best.filename}`);
    expect(r.originalBytes).toBe(ORIGINAL.length);
    expect(r.originalSha256).toBe(sha256(ORIGINAL));
    const frameReads = c.downloads.filter(d => d.includes("/frames/"));
    expect(frameReads).toEqual([`scans/${USER}/${ODM}/frames/${best.filename}`]);

    // The scale is measured on the decoded original, and the crop's pixels are finer than the uploaded frame's.
    expect(r.originalWidth).toBe(2736);
    expect(r.nativeScale).toBeCloseTo(2736 / 2400, 6);
    expect(r.exifScale).toBeCloseTo(5472 / 2400, 3);
    expect(r.nativeGsdM!).toBeLessThan(r.uploadedGsdM!);
    expect(r.nativeGsdM!).toBeCloseTo(r.uploadedGsdM! / (2736 / 2400), 9);
    expect(r.orthoGsdM).toBe(0.087);
    expect(typeof r.offNadirDeg).toBe("number");
    expect(r.viewAngleDeg).not.toBeNull();
    expect(r.cropWindow!.width).toBeGreaterThanOrEqual(400);
    expect(r.cropWindow!.x + r.cropWindow!.width).toBeLessThanOrEqual(2736);

    // The native crop on disk is the window, decoded back; the detector saw exactly that file.
    const nativeFile = join(out, r.native!.file);
    expect(existsSync(nativeFile)).toBe(true);
    const decoded = decodeImage(new Uint8Array(readFileSync(nativeFile)));
    expect([decoded.width, decoded.height]).toEqual([r.cropWindow!.width, r.cropWindow!.height]);
    expect(model.seen.map(s => s.mime).sort()).toEqual(["image/jpeg", "image/png"]);
    expect(model.seen.find(s => s.mime === "image/jpeg")!.sha).toBe(sha256(new Uint8Array(readFileSync(nativeFile))));
    expect(r.native!.model).toMatchObject({ status: "SUCCESS", count: 2, maxConfidence: 0.99, modelId: "fake/1" });
    expect(r.ortho).toMatchObject({ status: "OK", width: 48, height: 48, gsdM: 0.087, spanM: 3.6, model: { status: "SUCCESS_NO_DETECTIONS", count: 0 } });
    expect(run.summary).toMatchObject({ findings: 1, byStatus: { SUCCESS: 1 }, nativeDetections: 2, orthoDetections: 0, orthoScored: 1 });

    // The operator's word is copied, and nothing was written to any table.
    expect(r.operatorVerdict).toEqual({ verdict: "weed", verdictSource: "operator", species: "lambsquarters" });
    expect(r.storedPrediction).toMatchObject({ modelVersion: "weed-v1" });
    expect(c.ops.filter(o => !o.startsWith("select"))).toEqual([]);
    expect(c.uploads).toEqual([]);

    // The record and the page exist, name the finding, and carry no secret.
    const resultsPath = writeResults(out, run);
    const html = renderReport(run);
    writeFileSync(join(out, "index.html"), html);
    for (const text of [readFileSync(resultsPath, "utf8"), html]) {
      expect(text).toContain("spot-1");
      expect(text).toContain(best.filename);
      expect(text).not.toContain(SERVICE_KEY);
      expect(text).not.toContain(RF_KEY);
    }
    expect(html).toContain("not ground truth");
    expect(html).toContain("crops/spot-1-native.jpg");
    expect(html).toContain("crops/spot-1-ortho.png");
  });

  it("runs one finding by candidate id or row id, and refuses an id the scan does not hold", async () => {
    const objects = { ...storedReconstruction(), ...manifestFor([best.filename]) };
    const rows = [observation(), observation({ id: "row-2", candidate_id: "spot-2", lat: FAR.lat, lng: FAR.lng, chip_path: null })];
    const c = fakeClient({ observations: rows, objects });
    const one = await runBench({ scan: TASK_ID, finding: "row-2", out: outDir() }, deps(c, { fetchImpl: fakeFetch(objects) }));
    expect(one.findings.map(r => r.findingId)).toEqual(["spot-2"]);
    expect(one.findings[0]).toMatchObject({ status: "PROJECTION_FAILED", ortho: { status: "NO_ORTHO_CHIP" } });
    const all = await runBench({ scan: TASK_ID, out: outDir() }, deps(c, { fetchImpl: fakeFetch(objects) }));
    expect(all.findings.map(r => r.findingId)).toEqual(["spot-1", "spot-2"]);
    await expect(runBench({ scan: TASK_ID, finding: "spot-9", out: outDir() }, deps(c, { fetchImpl: fakeFetch(objects) }))).rejects.toThrow(/no saved finding "spot-9"/);
  });

  it("a region finding uses its stored ring", () => {
    const d = 0.00005;
    const ring = [{ lat: CENTRE.lat + d, lng: CENTRE.lng - d }, { lat: CENTRE.lat + d, lng: CENTRE.lng + d }, { lat: CENTRE.lat - d, lng: CENTRE.lng + d }, { lat: CENTRE.lat - d, lng: CENTRE.lng - d }];
    const c = candidateFromObservation(observation({ kind: "not-average region", geometry: [ring], class: "thin stand", features: null }));
    expect(c.region).toMatchObject({ klass: "thin stand", rings: [ring] });
    expect(c.blob).toBeNull();
    expect(candidateFromObservation(observation({ class: "nonsense", geometry: [ring] })).region!.klass).toBe("different from the field");
  });
});

describe("every way a finding can fail is named", () => {
  const point = { ...CENTRE, spanM: 3 };
  const bench = (objects: Store, over: Partial<BenchDeps> = {}, opts: Record<string, unknown> = {}) => {
    const c = fakeClient({ objects, failDownload: (over as { failDownload?: string[] }).failDownload });
    return runBench({ scan: TASK_ID, points: [point], out: outDir(), ...opts }, deps(c, { fetchImpl: fakeFetch(objects), ...over })).then(run => ({ run, c }));
  };

  it("NO_MANIFEST: a photo holds the shape but the scan kept no frame list", async () => {
    const { run } = await bench(storedReconstruction());
    expect(run.findings[0]).toMatchObject({ status: "NO_MANIFEST", selectedFrame: best.filename, originalPath: null });
    expect(run.findings[0].candidateFrames).toBeGreaterThan(0);
  });

  it("NO_NATIVE_SOURCE_FRAME: the frame list does not hold the best photo, and no other photo is substituted", async () => {
    const otherFrame = set.shots.find(s => s.filename !== best.filename)!.filename;
    const { run, c } = await bench({ ...storedReconstruction(), ...manifestFor([otherFrame]) });
    expect(run.findings[0]).toMatchObject({ status: "NO_NATIVE_SOURCE_FRAME", selectedFrame: best.filename, reason: expect.stringContaining("not in the frame list (1 kept)") });
    expect(c.downloads.some(d => d.includes("/frames/"))).toBe(false);
  });

  it("ORIGINAL_DOWNLOAD_FAILED: the manifest's key cannot be read", async () => {
    const { run } = await bench({ ...storedReconstruction(), ...manifestFor([best.filename]) }, { failDownload: [`${USER}/${ODM}/frames/${best.filename}`] } as Partial<BenchDeps>);
    expect(run.findings[0]).toMatchObject({ status: "ORIGINAL_DOWNLOAD_FAILED", originalPath: null });
  });

  it("ORIGINAL_DECODE_FAILED: the kept bytes are not an image", async () => {
    const objects = { ...storedReconstruction(), ...manifestFor([best.filename]) };
    objects[`scans/${USER}/${ODM}/frames/${best.filename}`] = new TextEncoder().encode("not an image at all");
    const { run } = await bench(objects);
    expect(run.findings[0]).toMatchObject({ status: "ORIGINAL_DECODE_FAILED", originalBytes: 19 });
  });

  it("RECONSTRUCTION_UNAVAILABLE: no poses, or poses with no ground height", async () => {
    const noArchive = await bench({}, {}, {});
    expect(noArchive.run.findings[0]).toMatchObject({ status: "RECONSTRUCTION_UNAVAILABLE", reason: expect.stringContaining("no camera poses") });
    const noStats = { ...storedReconstruction() };
    delete noStats[`scans/${reconstructionPrefix(USER, ODM)}/odm_report__stats.json`];
    const { run } = await bench(noStats);
    expect(run.findings[0]).toMatchObject({ status: "RECONSTRUCTION_UNAVAILABLE", reason: expect.stringContaining("no ground height") });
  });

  it("PROJECTION_FAILED: no photograph holds the shape; the nearest photo is not cut", async () => {
    const c = fakeClient({ objects: { ...storedReconstruction(), ...manifestFor([best.filename]) } });
    const run = await runBench({ scan: TASK_ID, points: [{ ...FAR, spanM: 3 }], out: outDir() }, deps(c, { fetchImpl: fakeFetch({}) }));
    expect(run.findings[0]).toMatchObject({ status: "PROJECTION_FAILED", candidateFrames: 0, selectedFrame: null });
    expect(c.downloads.some(d => d.includes("/frames/"))).toBe(false);
  });

  it("API_ERROR and MODEL_SKIPPED: the crop exists either way, with the detector's failure named", async () => {
    const objects = { ...storedReconstruction(), ...manifestFor([best.filename]) };
    const failing = fakeModel({ "image/jpeg": { ...SKIPPED, status: "API_ERROR", modelId: "fake/1", error: "HTTP 500: upstream" } });
    const { run } = await bench(objects, { model: failing });
    expect(run.findings[0]).toMatchObject({ status: "API_ERROR", reason: "HTTP 500: upstream" });
    expect(run.findings[0].native?.file).toMatch(/-native\.jpg$/);
    const { run: skipped } = await bench(objects, { model: null });
    expect(skipped.findings[0]).toMatchObject({ status: "MODEL_SKIPPED", native: { model: { status: "MODEL_SKIPPED" } } });
    expect(skipped.model.configured).toBe(false);
  });

  it("a scan with no saved findings runs nothing and says what to do", async () => {
    const c = fakeClient({ objects: storedReconstruction() });
    const run = await runBench({ scan: TASK_ID, out: outDir() }, deps(c, { fetchImpl: fakeFetch({}) }));
    expect(run.findings).toEqual([]);
    expect(run.notes.join(" ")).toMatch(/no saved findings/);
  });

  it("an unknown scan is an error, not an empty report", async () => {
    await expect(runBench({ scan: "deadbeef", out: outDir() }, deps(fakeClient()))).rejects.toThrow(/no scan matches/);
  });
});

// ---------------------------------------------------------------------------
// Offline: the reconstruction and the originals from folders
// ---------------------------------------------------------------------------

describe("the offline run, with --odm and --frames folders and no credentials", () => {
  it("cuts the same crop from a photo on disk and says the photo came from a folder", async () => {
    const framesDir = join(outDir(), "frames");
    mkdirSync(framesDir, { recursive: true });
    writeFileSync(join(framesDir, best.filename), ORIGINAL);
    const out = outDir();
    const run = await runBench({ odmDir: FIX, framesDir, points: [{ ...CENTRE, spanM: 3 }], out }, deps(null, { model: null }));
    expect(run.scan).toMatchObject({ taskId: null, reconstruction: "local-folder", originalsSource: "local-folder", posedFrames: 180 });
    expect(run.findings[0]).toMatchObject({ status: "MODEL_SKIPPED", selectedFrame: best.filename, originalSource: "local-folder", matchedBy: "filename", ortho: { status: "NO_ORTHO_CHIP" } });
    expect(run.notes.join(" ")).toMatch(/matched by filename/);
    expect(readdirSync(join(out, "crops"))).toHaveLength(1);
  });

  it("a frame missing from the folder is NO_NATIVE_SOURCE_FRAME, never another file", async () => {
    const framesDir = join(outDir(), "empty");
    mkdirSync(framesDir, { recursive: true });
    writeFileSync(join(framesDir, "unrelated.JPG"), ORIGINAL);
    const run = await runBench({ odmDir: FIX, framesDir, points: [{ ...CENTRE, spanM: 3 }], out: outDir() }, deps(null, { model: null }));
    expect(run.findings[0]).toMatchObject({ status: "NO_NATIVE_SOURCE_FRAME" });
  });

  it("refuses to run with neither a scan nor a reconstruction folder", async () => {
    await expect(runBench({ out: outDir() }, deps(null))).rejects.toThrow(/--scan/);
  });
});

// ---------------------------------------------------------------------------
// The detector adapter
// ---------------------------------------------------------------------------

describe("the baseline detector adapter", () => {
  const image = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

  it("sends the image, normalises the answer, and keeps the key out of every result", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain(`api_key=${RF_KEY}`);
      expect(String(url)).toContain("/weeds-nxe1w/1?");
      expect(String(init?.body)).toMatch(/^data:image\/jpeg;base64,/);
      return new Response(JSON.stringify({ time: 0.1, image: { width: 640, height: 480 }, predictions: [
        { x: 10, y: 20, width: 30, height: 40, confidence: 0.95, class: "weed" }, { x: 1, y: 2, width: 3, height: 4, confidence: 0.55, class: "weed" }, { bad: true },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await createRoboflowRunner({ apiKey: RF_KEY, fetchImpl }).detect(image, "image/jpeg");
    expect(r).toMatchObject({ status: "SUCCESS", modelId: "weeds-nxe1w/1", count: 2, maxConfidence: 0.95, imageWidth: 640 });
    expect(r.meanConfidence).toBeCloseTo(0.75, 9);
    expect(JSON.stringify(r)).not.toContain(RF_KEY);
    expect(createRoboflowRunner({ apiKey: RF_KEY }).describe()).toEqual({ provider: "roboflow", model: "weeds-nxe1w/1", endpointHost: "detect.roboflow.com", confidencePercent: 40, overlapPercent: 30 });
  });

  it("no predictions is SUCCESS_NO_DETECTIONS; a failed call is API_ERROR with the key redacted", async () => {
    expect(normalizeRoboflow({ predictions: [] }, "m/1", 5)).toMatchObject({ status: "SUCCESS_NO_DETECTIONS", count: 0, maxConfidence: null, meanConfidence: null });
    const http = createRoboflowRunner({ apiKey: RF_KEY, fetchImpl: (async () => new Response(`forbidden for ${RF_KEY}`, { status: 403 })) as unknown as typeof fetch });
    const e1 = await http.detect(image, "image/jpeg");
    expect(e1.status).toBe("API_ERROR");
    expect(e1.error).toBe("HTTP 403: forbidden for ***");
    const thrown = createRoboflowRunner({ apiKey: RF_KEY, fetchImpl: (async () => { throw new Error(`ECONNRESET ${RF_KEY}`); }) as unknown as typeof fetch });
    expect((await thrown.detect(image, "image/jpeg")).error).toBe("ECONNRESET ***");
    const notJson = createRoboflowRunner({ apiKey: RF_KEY, fetchImpl: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch });
    expect((await notJson.detect(image, "image/jpeg")).status).toBe("API_ERROR");
  });
});

// ---------------------------------------------------------------------------
// The command line, and the wall between this tooling and the app
// ---------------------------------------------------------------------------

describe("the command line", () => {
  it("parses repeated points, flags and values", () => {
    const a = parseArgs(["--scan", "abc", "--point", "1,2", "--point", "3,4,5", "--no-model", "--limit", "3"]);
    expect(a).toEqual({ scan: "abc", point: ["1,2", "3,4,5"], "no-model": true, limit: "3" });
    expect(parsePoint("54.1, 12.3, 4")).toEqual({ lat: 54.1, lng: 12.3, spanM: 4 });
    expect(parsePoint("54.1,12.3")).toEqual({ lat: 54.1, lng: 12.3, spanM: undefined });
    expect(() => parsePoint("x")).toThrow(/lat,lng/);
  });
});

describe("credentials and the detector never reach the app", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const appFiles = walk(join(process.cwd(), "src")).filter(p => /\.(ts|tsx)$/.test(p) && !p.includes(`${join("src", "test")}`));

  it("no app module imports the benchmark, the service-role key, the detector's key or its service", () => {
    for (const p of appFiles) {
      const text = readFileSync(p, "utf8");
      expect(text, p).not.toMatch(/from ["'][^"']*scripts\/bench/);
      expect(text, p).not.toMatch(/SERVICE_ROLE/);
      expect(text, p).not.toMatch(/ROBOFLOW_API/);
      expect(text, p).not.toMatch(/roboflow\.com/i);
      // The detector's call lives in the shared module; the app may take its types and nothing else.
      for (const line of text.split(/\r?\n/).filter(l => /_shared\/roboflow/.test(l))) expect(line, p).toMatch(/^import type /);
    }
  });

  it("the benchmark never imports the browser's Supabase client", () => {
    for (const p of walk(join(process.cwd(), "scripts", "bench"))) {
      expect(readFileSync(p, "utf8"), p).not.toMatch(/integrations\/supabase\/client/);
    }
  });
});
