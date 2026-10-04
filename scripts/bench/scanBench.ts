// The Layer 2 benchmark on a real scan, from the terminal: for each finding
// the map flagged, the photograph that saw it best, the kept original of that
// photograph, the finding's ground cut out of it at the camera's resolution,
// and a baseline detector's word on that crop next to its word on the ortho
// chip.
//
// Nothing here is new geometry. Which photos hold a shape, which is best, and
// what rectangle to cut are the app's own functions (lib/sourceFrames, shared
// with the in-app panel through benchCore.ts); the archive and the frame list
// are read by the app's own loader with a service-role client instead of the
// browser's. What this adds is the wiring, the Node-side pixels, the detector,
// the record and the page.
//
// What it never does: read the 2,400 px copy as if it were the original (it
// is not in our storage), build a storage key from a filename (the manifest
// is the only map), or write to a finding. The operator's verdict is copied
// into the record and nothing is written back.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FindingInput, baseResult, chooseFrame, outlineInChip, outlineInCrop, recordChoice } from "@/lib/sourceFrames/benchCore";
import { type BenchRun, type BenchStatus, type FindingResult, type OriginalsSource, SKIPPED, statusFromModel, summarize } from "@/lib/sourceFrames/benchTypes";
import { areaWindow } from "@/lib/sourceFrames/crop";
import { type FrameIndex, lookupOriginal } from "@/lib/sourceFrames/manifest";
import {
  RECONSTRUCTION_MEMBERS, type ReconstructionFiles, type ScanSources, type StorageClient,
  downloadFrameWith, loadScanSourcesWith, sourcesFromFiles,
} from "@/lib/sourceFrames/sources";
import type { Candidate, Region, RegionClass } from "@/lib/weedScout/types";
import { type Rgba, cropRgba, decodeImage, encodeJpeg, imageSize, sha256 } from "./images";
import type { ModelRunner } from "./roboflow";

export type { BenchRun, BenchStatus, FindingResult } from "@/lib/sourceFrames/benchTypes";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type ScanTask = {
  id: string;
  user_id: string;
  field_id: string | null;
  odm_uuid: string | null;
  status: string;
  output_path: string | null;
  image_count: number | null;
  created_at: string | null;
};

/** The columns of a weed_observations row the benchmark reads. */
export type ObservationLite = {
  id: string;
  candidate_id: string;
  lat: number;
  lng: number;
  kind: string;
  score: number | null;
  geometry: unknown;
  area_m2: number | null;
  class: string | null;
  features: unknown;
  chip_path: string | null;
  chip_gsd_m: number | null;
  chip_span_m: number | null;
  verdict: string | null;
  verdict_source: string | null;
  finding_class: string | null;
  species: string | null;
  prediction: unknown;
  model_version: string | null;
};

export const OBSERVATION_COLUMNS =
  "id, candidate_id, lat, lng, kind, score, geometry, area_m2, class, features, chip_path, chip_gsd_m, chip_span_m, verdict, verdict_source, finding_class, species, prediction, model_version";
export const TASK_COLUMNS = "id, user_id, field_id, odm_uuid, status, output_path, image_count, created_at";

export type Finding = FindingInput;

type QueryResult<T> = { data: T | null; error: { message: string } | null };
/** The slice of the PostgREST builder this module uses; the real client satisfies it structurally. */
export type Query = PromiseLike<QueryResult<unknown>> & {
  select(cols: string): Query;
  eq(col: string, v: unknown): Query;
  ilike(col: string, v: string): Query;
  order(col: string, o: { ascending: boolean }): Query;
  limit(n: number): Query;
  maybeSingle(): PromiseLike<QueryResult<unknown>>;
};
export type DbClient = { from(table: string): Query };

/** Where originals come from: the scan's manifest and storage, or a folder on disk for an offline check. */
export type OriginalSource = {
  kind: OriginalsSource;
  resolve(odmFilename: string): Promise<
    | { ok: true; bytes: Uint8Array; path: string; matchedBy: "filename" | "odm-rename" }
    | { ok: false; status: "NO_MANIFEST" | "NO_NATIVE_SOURCE_FRAME" | "ORIGINAL_DOWNLOAD_FAILED"; reason: string }
  >;
};

export type BenchDeps = {
  /** Read-only use: odm_tasks and weed_observations are only ever SELECTed. Null for a fully local run. */
  db: DbClient | null;
  storage: StorageClient | null;
  fetchImpl: typeof fetch;
  model: ModelRunner | null;
  log: (line: string) => void;
  now: () => string;
};

export type BenchOptions = {
  /** odm_tasks.id, odm_uuid, or a prefix of odm_uuid. */
  scan?: string | null;
  /** A folder with cameras.json, shots.geojson, images.json, stats.json instead of the scan's storage. */
  odmDir?: string | null;
  /** A folder of originals by camera filename instead of the scan's kept frames. Labelled as such in the record. */
  framesDir?: string | null;
  /** Ad-hoc findings, each a square of `spanM` metres (default 3) around a point. */
  points?: { lat: number; lng: number; spanM?: number }[];
  /** One finding only: its candidate_id or its weed_observations.id. */
  finding?: string | null;
  limit?: number | null;
  /** Score the stored ortho chip with the same detector. Default true. */
  compareOrtho?: boolean;
  out: string;
};

// ---------------------------------------------------------------------------
// Resolving the scan and its findings
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The scan row by its id, its ODM uuid, or an unambiguous prefix of the uuid. Null when nothing matches. */
export async function resolveTask(db: DbClient, ref: string): Promise<ScanTask | null> {
  const r = ref.trim();
  if (!r) return null;
  if (UUID.test(r)) {
    const { data, error } = await db.from("odm_tasks").select(TASK_COLUMNS).eq("id", r).maybeSingle();
    if (error) throw new Error(`odm_tasks: ${error.message}`);
    if (data) return data as ScanTask;
  }
  const { data, error } = await db.from("odm_tasks").select(TASK_COLUMNS).ilike("odm_uuid", `${r.replace(/[%_]/g, "")}%`).limit(5);
  if (error) throw new Error(`odm_tasks: ${error.message}`);
  const rows = (data ?? []) as ScanTask[];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw new Error(`"${r}" matches ${rows.length} scans (${rows.map(t => t.odm_uuid).join(", ")}); give more of the uuid`);
  return null;
}

/** The archive's rows for a scan, best score first. */
export async function loadObservations(db: DbClient, taskId: string): Promise<ObservationLite[]> {
  const { data, error } = await db.from("weed_observations").select(OBSERVATION_COLUMNS).eq("scan_id", taskId).order("score", { ascending: false });
  if (error) throw new Error(`weed_observations: ${error.message}`);
  return (data ?? []) as ObservationLite[];
}

const REGION_CLASSES: readonly RegionClass[] = [
  "bare or dry ground", "dark ground (wet, shadow or residue)", "thin stand", "dense vegetation",
  "pale vegetation", "greener than the field", "different from the field",
];

function emptyCandidate(id: string, centroid: { lat: number; lng: number }, kind: string): Candidate {
  return {
    id, tileId: "", centroid, kind: kind as Candidate["kind"], score: 0,
    distanceToRowM: null, rowConfidence: null, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
    blob: null, region: null, areaM2: 0, feedback: null, estimate: null, prediction: null,
    chip: null, chipSpanM: null, chipGsdM: null,
  };
}

/** A stored row as the candidate the app's step three reads: centroid, region ring, blob size, chip span and GSD. */
export function candidateFromObservation(r: ObservationLite): Candidate {
  const c = emptyCandidate(r.candidate_id, { lat: r.lat, lng: r.lng }, r.kind);
  const rings = Array.isArray(r.geometry) ? (r.geometry as { lat: number; lng: number }[][]) : null;
  const ring = rings?.[0];
  let region: Region | null = null;
  if (ring && ring.length >= 3 && ring.every(p => typeof p?.lat === "number" && typeof p?.lng === "number")) {
    region = {
      id: r.candidate_id, tileIds: [], rings, centroid: c.centroid, areaM2: r.area_m2 ?? 0, tileCount: 0, coreTiles: 0,
      meanStrength: 0, maxStrength: 0, meanFieldZ: [], drivers: [],
      klass: REGION_CLASSES.includes(r.class as RegionClass) ? (r.class as RegionClass) : "different from the field",
    };
  }
  const f = r.features as { equivDiameterM?: unknown } | null;
  const blob = f && typeof f.equivDiameterM === "number" ? (r.features as Candidate["blob"]) : null;
  return { ...c, score: r.score ?? 0, region, blob, areaM2: r.area_m2 ?? 0, chipSpanM: r.chip_span_m, chipGsdM: r.chip_gsd_m };
}

/** An ad-hoc square on the ground, for a plumbing check when a scan has no saved findings. */
export function pointCandidate(p: { lat: number; lng: number; spanM?: number }): Candidate {
  const span = p.spanM && p.spanM > 0 ? p.spanM : 3;
  const dLat = span / 2 / 111_320, dLng = span / 2 / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  const ring = [
    { lat: p.lat + dLat, lng: p.lng - dLng }, { lat: p.lat + dLat, lng: p.lng + dLng },
    { lat: p.lat - dLat, lng: p.lng + dLng }, { lat: p.lat - dLat, lng: p.lng - dLng },
  ];
  const id = `point:${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const c = emptyCandidate(id, { lat: p.lat, lng: p.lng }, "not-average region");
  return {
    ...c, areaM2: span * span, chipSpanM: span,
    region: { id, tileIds: [], rings: [ring], centroid: c.centroid, areaM2: span * span, tileCount: 0, coreTiles: 0, meanStrength: 0, maxStrength: 0, meanFieldZ: [], drivers: [], klass: "different from the field" },
  };
}

export function findingsFromObservations(rows: ObservationLite[], opts: Pick<BenchOptions, "finding" | "limit">): Finding[] {
  let picked = rows;
  if (opts.finding) {
    picked = rows.filter(r => r.candidate_id === opts.finding || r.id === opts.finding);
    if (!picked.length) {
      const sample = rows.slice(0, 20).map(r => r.candidate_id).join(", ");
      throw new Error(`no saved finding "${opts.finding}" on this scan; ${rows.length} saved${rows.length ? ` (first ids: ${sample})` : ""}`);
    }
  }
  if (opts.limit && opts.limit > 0) picked = picked.slice(0, opts.limit);
  return picked.map(r => ({
    id: r.candidate_id, rowId: r.id, source: "weed_observations" as const, candidate: candidateFromObservation(r),
    kind: r.kind, findingClass: r.finding_class, verdict: r.verdict, verdictSource: r.verdict_source, species: r.species,
    chipPath: r.chip_path, storedPrediction: r.prediction ?? null, storedModelVersion: r.model_version,
  }));
}

export function findingsFromPoints(points: { lat: number; lng: number; spanM?: number }[]): Finding[] {
  return points.map(p => {
    const candidate = pointCandidate(p);
    return {
      id: candidate.id, rowId: null, source: "point" as const, candidate, kind: candidate.kind, findingClass: null,
      verdict: null, verdictSource: null, species: null, chipPath: null, storedPrediction: null, storedModelVersion: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Sources: the reconstruction and the originals
// ---------------------------------------------------------------------------

/** The four reconstruction documents from a folder (the shape of src/test/fixtures/odm-*). */
export function reconstructionFromDir(dir: string): ReconstructionFiles {
  const read = (names: string[]): unknown => {
    for (const n of names) {
      const p = join(dir, n);
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    }
    return undefined;
  };
  return {
    cameras: read([RECONSTRUCTION_MEMBERS.cameras]),
    shots: read([RECONSTRUCTION_MEMBERS.shots, "shots.geojson"]),
    images: read([RECONSTRUCTION_MEMBERS.images]),
    stats: read([RECONSTRUCTION_MEMBERS.stats, "stats.json"]),
  };
}

/** The scan's kept originals, through the manifest and nothing else. */
export function retainedOriginals(storage: StorageClient, frames: FrameIndex | null): OriginalSource {
  return {
    kind: "retained-original",
    async resolve(odmFilename) {
      const found = lookupOriginal(frames, odmFilename);
      // Explicit comparisons: the app compiles without strictNullChecks, where truthiness does not narrow.
      if (found.ok === false) return found;
      let blob: Blob | null = null;
      try { blob = await downloadFrameWith(storage, found.entry); } catch (e) {
        return { ok: false, status: "ORIGINAL_DOWNLOAD_FAILED", reason: `${found.entry.path}: ${(e as Error)?.message ?? e}` };
      }
      if (!blob) return { ok: false, status: "ORIGINAL_DOWNLOAD_FAILED", reason: `${found.entry.path}: storage returned nothing` };
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!bytes.length) return { ok: false, status: "ORIGINAL_DOWNLOAD_FAILED", reason: `${found.entry.path}: empty object` };
      return { ok: true, bytes, path: found.entry.path, matchedBy: found.matchedBy };
    },
  };
}

/**
 * Originals from a folder on disk, by the camera's filename or its ODM name.
 * An offline convenience for a developer who has the flight's photos; the
 * record says the crop came from a folder, not from the scan's kept frames.
 */
export function localOriginals(dir: string): OriginalSource {
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const index: FrameIndex = Object.fromEntries(names.map(n => [n, { filename: n, path: join(dir, n), bytes: 0, type: "", lastModified: 0 }]));
  return {
    kind: "local-folder",
    async resolve(odmFilename) {
      const found = lookupOriginal(names.length ? index : null, odmFilename);
      if (found.ok === false) return found.status === "NO_MANIFEST" ? { ok: false, status: "NO_NATIVE_SOURCE_FRAME", reason: `folder ${dir} is empty or missing` } : found;
      try {
        return { ok: true, bytes: new Uint8Array(readFileSync(found.entry.path)), path: found.entry.path, matchedBy: found.matchedBy };
      } catch (e) {
        return { ok: false, status: "ORIGINAL_DOWNLOAD_FAILED", reason: `${found.entry.path}: ${(e as Error)?.message ?? e}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// One finding
// ---------------------------------------------------------------------------

type Ctx = {
  sources: ScanSources;
  originals: OriginalSource;
  storage: StorageClient | null;
  model: ModelRunner | null;
  compareOrtho: boolean;
  outDir: string;
  log: (line: string) => void;
};

const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);

export async function benchFinding(f: Finding, ctx: Ctx): Promise<FindingResult> {
  const base = baseResult(f, ctx.compareOrtho);
  const fail = (status: BenchStatus, reason: string): FindingResult => ({ ...base, status, reason });

  // The ortho side is independent of the native side; score it first so a
  // native failure still leaves the comparison's left half in the record.
  if (ctx.compareOrtho) base.ortho = await orthoSide(f, ctx, base.ortho);

  const choice = chooseFrame(ctx.sources, f.candidate);
  const failed = recordChoice(base, choice);
  if (failed) return failed;
  if (choice.ok === false) return failed!;
  const { view, uploadedWidth } = choice;

  const original = await ctx.originals.resolve(view.filename);
  if (original.ok === false) return fail(original.status, original.reason);
  Object.assign(base, {
    originalPath: original.path, originalBytes: original.bytes.length, originalSha256: sha256(original.bytes),
    originalSource: ctx.originals.kind, matchedBy: original.matchedBy,
  });

  let decoded: Rgba;
  try { decoded = decodeImage(original.bytes); } catch (e) {
    return fail("ORIGINAL_DECODE_FAILED", `${original.path}: ${(e as Error).message}`);
  }
  const scale = decoded.width / uploadedWidth;
  Object.assign(base, { originalWidth: decoded.width, originalHeight: decoded.height, nativeScale: scale, nativeGsdM: view.gsdM / scale });

  if (view.box.x1 <= view.box.x0 || view.box.y1 <= view.box.y0) return fail("CROP_OUT_OF_BOUNDS", "the shape's box in this frame has no area");
  const win = areaWindow(view.box, scale, decoded.width, decoded.height);
  if (win.width <= 0 || win.height <= 0) return fail("CROP_OUT_OF_BOUNDS", "the window collapsed to nothing");
  base.cropWindow = win;
  base.outlineCropPx = outlineInCrop(view, scale, win);

  let crop: Rgba;
  try { crop = cropRgba(decoded, win); } catch (e) { return fail("CROP_OUT_OF_BOUNDS", (e as Error).message); }
  const jpegBytes = encodeJpeg(crop, 92);
  const file = `crops/${safeName(f.id)}-native.jpg`;
  writeFileSync(join(ctx.outDir, file), jpegBytes);

  const model = ctx.model ? await ctx.model.detect(jpegBytes, "image/jpeg") : SKIPPED;
  base.native = { file, width: crop.width, height: crop.height, model };
  return { ...base, status: statusFromModel(model), reason: model.status === "API_ERROR" ? model.error : null };
}

async function orthoSide(f: Finding, ctx: Ctx, prior: FindingResult["ortho"]): Promise<FindingResult["ortho"]> {
  if (!f.chipPath || !ctx.storage) return prior;
  let bytes: Uint8Array | null = null;
  try {
    const { data, error } = await ctx.storage.storage.from("weed-chips").download(f.chipPath);
    if (!error && data) bytes = new Uint8Array(await data.arrayBuffer());
  } catch { bytes = null; }
  if (!bytes || !bytes.length) return { ...prior, status: "CHIP_DOWNLOAD_FAILED" };
  const size = imageSize(bytes);
  const file = `crops/${safeName(f.id)}-ortho.png`;
  writeFileSync(join(ctx.outDir, file), bytes);
  const outlinePx = size ? outlineInChip(f.candidate, size.width, size.height) : null;
  const model = ctx.model ? await ctx.model.detect(bytes, "image/png") : SKIPPED;
  return { ...prior, status: "OK", file, width: size?.width ?? null, height: size?.height ?? null, outlinePx, model };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runBench(opts: BenchOptions, deps: BenchDeps): Promise<BenchRun> {
  const notes: string[] = [];
  const log = deps.log;

  // -- the scan ------------------------------------------------------------
  let task: ScanTask | null = null;
  if (opts.scan) {
    if (!deps.db) throw new Error("--scan needs Supabase credentials (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
    task = await resolveTask(deps.db, opts.scan);
    if (!task) throw new Error(`no scan matches "${opts.scan}" (odm_tasks.id, odm_uuid or a uuid prefix)`);
    log(`scan ${task.id} (odm ${task.odm_uuid ?? "none"}, ${task.status}, ${task.image_count ?? "?"} images, archive ${task.output_path ?? "none"})`);
    if (task.status !== "completed") notes.push(`The scan's status is "${task.status}", not completed; its archive may not exist yet.`);
  } else if (!opts.odmDir) {
    throw new Error("give --scan <id>, or --odm <dir> for an offline run");
  }

  // -- the reconstruction and the frame list --------------------------------
  let sources: ScanSources;
  if (opts.odmDir) {
    sources = sourcesFromFiles(reconstructionFromDir(opts.odmDir), "stored", null, m => notes.push(m));
    if (task && deps.storage) {
      // The frame list still comes from the scan: a local reconstruction does not change where the originals are.
      const fromScan = await loadScanSourcesWith(deps.storage, { userId: task.user_id, odmUuid: task.odm_uuid ?? "", outputPath: null }, { fetchImpl: deps.fetchImpl, warn: m => notes.push(m) });
      sources = { ...sources, frames: fromScan.frames };
    }
    if (sources.reconstruction === "none") notes.push(`No usable reconstruction in ${opts.odmDir}.`);
  } else {
    if (!deps.storage || !task?.odm_uuid) throw new Error("the scan has no ODM uuid; nothing to read");
    sources = await loadScanSourcesWith(deps.storage, { userId: task.user_id, odmUuid: task.odm_uuid, outputPath: task.output_path }, { fetchImpl: deps.fetchImpl, warn: m => notes.push(m) });
  }
  log(`reconstruction: ${opts.odmDir ? `local folder (${sources.reconstruction})` : sources.reconstruction}; posed frames ${sources.set?.shots.length ?? 0}; ground altitude ${sources.groundAltM == null ? "unknown" : `${sources.groundAltM.toFixed(1)} m`}; frames kept ${sources.frames ? Object.keys(sources.frames).length : "none (no frame list)"}`);

  const originals: OriginalSource = opts.framesDir
    ? localOriginals(opts.framesDir)
    : deps.storage ? retainedOriginals(deps.storage, sources.frames) : localOriginals("");
  if (opts.framesDir) notes.push(`Originals were read from ${opts.framesDir}, matched by filename; the scan's kept frames were not used.`);

  // -- the findings --------------------------------------------------------
  let findings: Finding[] = [];
  let findingsSource = "none";
  if (opts.points?.length) {
    findings = findingsFromPoints(opts.points);
    findingsSource = `${opts.points.length} point${opts.points.length === 1 ? "" : "s"} given on the command line`;
  } else if (task && deps.db) {
    const rows = await loadObservations(deps.db, task.id);
    findings = findingsFromObservations(rows, opts);
    findingsSource = `weed_observations for scan ${task.id}: ${rows.length} saved, ${findings.length} run`;
    if (!rows.length) notes.push("The scan has no saved findings. Run Weed Scout on it and press Save all, or give --point lat,lng for a plumbing check.");
  } else {
    notes.push("No findings: give --point lat,lng[,spanM] with an offline run.");
  }
  log(`findings: ${findingsSource}`);

  // -- each finding --------------------------------------------------------
  mkdirSync(join(opts.out, "crops"), { recursive: true });
  const ctx: Ctx = { sources, originals, storage: deps.storage, model: deps.model, compareOrtho: opts.compareOrtho !== false, outDir: opts.out, log };
  const results: FindingResult[] = [];
  for (const f of findings) {
    const r = await benchFinding(f, ctx);
    results.push(r);
    const n = r.native?.model, o = r.ortho.model;
    log(`  ${r.findingId}: ${r.status}${r.reason ? ` (${r.reason})` : ""}${r.selectedFrame ? `; frame ${r.selectedFrame} of ${r.candidateFrames}` : ""}${n ? `; native ${n.count} det${n.maxConfidence != null ? ` max ${n.maxConfidence.toFixed(2)}` : ""}` : ""}${o ? `; ortho ${o.count} det` : ""}`);
  }

  return {
    generatedAt: deps.now(),
    scan: {
      taskId: task?.id ?? null, odmUuid: task?.odm_uuid ?? null, userId: task?.user_id ?? null, fieldId: task?.field_id ?? null,
      status: task?.status ?? null, outputPath: task?.output_path ?? null, imageCount: task?.image_count ?? null,
      reconstruction: opts.odmDir ? "local-folder" : sources.reconstruction, groundAltM: sources.groundAltM,
      posedFrames: sources.set?.shots.length ?? 0, framesKept: sources.frames ? Object.keys(sources.frames).length : null,
      originalsSource: originals.kind, findingsSource,
    },
    model: { configured: !!deps.model, id: deps.model?.id ?? null, settings: deps.model?.describe() ?? null },
    findings: results,
    summary: summarize(results),
    notes,
  };
}

/** results.json beside the crops; the page is the caller's (lib/sourceFrames/benchReport.ts). */
export function writeResults(out: string, run: BenchRun): string {
  mkdirSync(out, { recursive: true });
  const p = join(out, "results.json");
  writeFileSync(p, JSON.stringify(run, null, 2));
  return p;
}
