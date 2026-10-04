// The Layer 2 benchmark in the browser, on the scan that is open.
//
// The same steps as the terminal tool, run as the signed-in operator: the
// scout's ranked shapes are the findings, the photograph that holds each one
// best comes from the app's own step three, the kept original is read through
// the frame list under the operator's own access, the finding's ground is cut
// from it at the camera's resolution with a canvas, and the detector is asked
// through the bench-detect edge function, which holds the key. The record is
// the same shape and the page is the same page.
//
// Nothing is saved. The operator's verdict is copied into the record from
// what is on screen and never written anywhere by this module.
import type { Candidate } from "../weedScout/types";
import { type FindingInput, baseResult, chooseFrame, outlineInChip, outlineInCrop, recordChoice, sha256Hex } from "./benchCore";
import { type BenchRun, type FindingResult, type ModelResult, SKIPPED, statusFromModel, summarize } from "./benchTypes";
import { type NativeCut, cutNativeWindow } from "./crop";
import { type FrameManifestEntry, lookupOriginal } from "./manifest";
import { downloadFrame as downloadFrameDefault } from "./scan";
import type { ScanSources } from "./sources";

export type Detect = (blob: Blob, mime: "image/jpeg" | "image/png") => Promise<ModelResult>;

export type BrowserBenchInput = {
  sources: ScanSources;
  /** The scout's shapes, best first; the first `limit` with a chip or a region are run. */
  candidates: Candidate[];
  limit: number;
  scan: { taskId: string; odmUuid: string | null; userId: string | null };
  /** What the operator has said about a shape, on screen or in the archive. */
  verdictOf: (c: Candidate) => { verdict: string | null; verdictSource: string | null; species: string | null };
  stored: (c: Candidate) => { prediction: unknown; modelVersion: string | null } | null;
  /** Null runs geometry and crops only. */
  detect: Detect | null;
  modelSettings: Record<string, string | number> | null;
  compareOrtho?: boolean;
  onProgress?: (done: number, total: number, line: string) => void;
  /** For tests: the storage read and the canvas work, replaceable. */
  deps?: {
    downloadFrame?: (entry: FrameManifestEntry) => Promise<Blob | null>;
    cut?: typeof cutNativeWindow;
    toDataUrl?: (blob: Blob) => Promise<string>;
    imageSize?: (blob: Blob) => Promise<{ width: number; height: number } | null>;
  };
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

async function bitmapSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return null;
  const size = { width: bmp.width, height: bmp.height };
  bmp.close?.();
  return size;
}

const dataUrlToBlob = async (dataUrl: string): Promise<Blob | null> => fetch(dataUrl).then(r => r.blob()).catch(() => null);

function findingOf(c: Candidate, input: BrowserBenchInput): FindingInput {
  const v = input.verdictOf(c);
  const s = input.stored(c);
  return {
    id: c.id, rowId: null, source: "scout_run", candidate: c, kind: c.kind, findingClass: null,
    verdict: v.verdict, verdictSource: v.verdictSource, species: v.species,
    chipPath: null, storedPrediction: s?.prediction ?? null, storedModelVersion: s?.modelVersion ?? null,
  };
}

export async function benchOneInBrowser(c: Candidate, input: BrowserBenchInput): Promise<FindingResult> {
  const deps = input.deps ?? {};
  const download = deps.downloadFrame ?? downloadFrameDefault;
  const cut = deps.cut ?? cutNativeWindow;
  const toDataUrl = deps.toDataUrl ?? blobToDataUrl;
  const sizeOf = deps.imageSize ?? bitmapSize;
  const compareOrtho = input.compareOrtho !== false;
  const r = baseResult(findingOf(c, input), compareOrtho);
  const fail = (status: FindingResult["status"], reason: string): FindingResult => ({ ...r, status, reason });

  // The ortho side first: the chip the scout rendered, scored as it is.
  if (compareOrtho && c.chip) {
    const blob = await dataUrlToBlob(c.chip);
    const size = blob ? await sizeOf(blob) : null;
    if (blob && size) {
      const model = input.detect ? await input.detect(blob, blob.type === "image/jpeg" ? "image/jpeg" : "image/png") : SKIPPED;
      r.ortho = { ...r.ortho, status: "OK", file: c.chip, width: size.width, height: size.height, outlinePx: outlineInChip(c, size.width, size.height), model };
    } else {
      r.ortho = { ...r.ortho, status: "CHIP_DOWNLOAD_FAILED" };
    }
  }

  const choice = chooseFrame(input.sources, c);
  const failed = recordChoice(r, choice);
  if (failed) return failed;
  if (choice.ok === false) return failed!;
  const { view, uploadedWidth } = choice;

  const found = lookupOriginal(input.sources.frames, view.filename);
  if (found.ok === false) return fail(found.status, found.reason);
  let frame: Blob | null = null;
  try { frame = await download(found.entry); } catch { frame = null; }
  if (!frame || !frame.size) return fail("ORIGINAL_DOWNLOAD_FAILED", `${found.entry.path}: the original could not be read from storage`);
  Object.assign(r, {
    originalPath: found.entry.path, originalBytes: frame.size, originalSource: "retained-original", matchedBy: found.matchedBy,
    originalSha256: await sha256Hex(new Uint8Array(await frame.arrayBuffer())),
  });

  if (view.box.x1 <= view.box.x0 || view.box.y1 <= view.box.y0) return fail("CROP_OUT_OF_BOUNDS", "the shape's box in this frame has no area");
  let native: NativeCut | null = null;
  try { native = await cut(frame, view.box, uploadedWidth); } catch { native = null; }
  if (!native) return fail("ORIGINAL_DECODE_FAILED", `${found.entry.path}: the original could not be decoded in this browser`);
  Object.assign(r, {
    originalWidth: native.originalWidth, originalHeight: native.originalHeight, nativeScale: native.scale,
    nativeGsdM: view.gsdM / native.scale, cropWindow: native.window, outlineCropPx: outlineInCrop(view, native.scale, native.window),
  });
  const model = input.detect ? await input.detect(native.blob, "image/jpeg") : SKIPPED;
  r.native = { file: await toDataUrl(native.blob), width: native.width, height: native.height, model };
  return { ...r, status: statusFromModel(model), reason: model.status === "API_ERROR" ? model.error : null };
}

export async function runBrowserBench(input: BrowserBenchInput): Promise<BenchRun> {
  const picked = input.candidates.slice(0, Math.max(0, input.limit));
  const results: FindingResult[] = [];
  for (const [i, c] of picked.entries()) {
    const r = await benchOneInBrowser(c, input);
    results.push(r);
    input.onProgress?.(i + 1, picked.length, `${r.findingId}: ${r.status}${r.native?.model.count ? `, ${r.native.model.count} native detection${r.native.model.count === 1 ? "" : "s"}` : ""}`);
  }
  const s = input.sources;
  const notes: string[] = [];
  if (!picked.length) notes.push("No shapes to run: scan the field first.");
  if (!s.frames) notes.push("No frame list for this scan: the originals were not kept, so no native crop can be cut.");
  return {
    generatedAt: new Date().toISOString(),
    scan: {
      taskId: input.scan.taskId, odmUuid: input.scan.odmUuid, userId: input.scan.userId, fieldId: null, status: null, outputPath: null, imageCount: null,
      reconstruction: s.reconstruction, groundAltM: s.groundAltM, posedFrames: s.set?.shots.length ?? 0,
      framesKept: s.frames ? Object.keys(s.frames).length : null, originalsSource: "retained-original",
      findingsSource: `the scout's ranked shapes on this scan: ${picked.length} of ${input.candidates.length} run`,
    },
    model: { configured: !!input.detect, id: input.modelSettings ? String(input.modelSettings.model ?? "") || null : null, settings: input.modelSettings },
    findings: results,
    summary: summarize(results),
    notes,
  };
}
