// The model run over a scan's photographs: the store with its seams replaced
// (service, storage, cache), and the panel that drives it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import { ModelDetectionsPanel } from "@/components/app/weedVision/ModelDetectionsPanel";
import type { FrameIndex } from "@/lib/sourceFrames/manifest";
import { groundAltitudeFromOdm, parseOdmOutputs, projectToFrame } from "@/lib/sourceFrames/odm";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import type { WeedVisionResult } from "@/lib/weedVision/client";
import { frameRunKey } from "@/lib/weedVision/frames";
import type { SavedFrameRun } from "@/lib/weedVision/frameRunCache";
import { type FrameRunDeps, addFrameDetections, getFrameRun, resetFrameRunStore, restoreFrameRun, scorableFrames, setFrameRunBoundary, startFrameRun, stopFrameRun } from "@/lib/weedVision/frameRunStore";

const DIR = join(process.cwd(), "src", "test", "fixtures", "odm-dd0f6314");
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const set = parseOdmOutputs({ camerasJson: read("cameras.json"), shotsGeojson: read("shots.geojson"), imagesJson: read("images.json") });
const groundAltM = groundAltitudeFromOdm(set, read("stats.json").odm_processing_statistics.average_gsd)!;
const CENTRE = { lat: 54.17259, lng: 12.30625 };
const NATIVE_W = 5472, NATIVE_H = 3648;

/** Three kept originals: the two best views of CENTRE and one more. */
function sourcesWithFrames(n = 3): ScanSources {
  const seen = set.shots.map(shot => ({ shot, p: projectToFrame(set, shot, { ...CENTRE, altM: groundAltM }) })).filter(x => x.p?.inside).sort((a, b) => a.p!.viewAngleDeg - b.p!.viewAngleDeg).slice(0, n);
  const frames: FrameIndex = {};
  for (const { shot } of seen) frames[shot.filename] = { filename: shot.filename, path: `u/o/frames/${shot.filename}`, bytes: 10, type: "image/jpeg", lastModified: 0 };
  return { set, stats: null, groundAltM, frames, reconstruction: "stored" };
}

function resultAt(shot: { filename: string; cameraKey: string }, point: { lat: number; lng: number }, score = 0.8): WeedVisionResult {
  const cam = set.cameras[shot.cameraKey];
  const scale = NATIVE_W / cam.width;
  const p = projectToFrame(set, shot as never, { ...point, altM: groundAltM })!;
  const cx = p.u * scale, cy = p.v * scale, r = 50;
  const poly: [number, number][] = Array.from({ length: 16 }, (_, i) => { const a = (2 * Math.PI * i) / 16; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const inst = { id: 1, centroid_px: [cx, cy] as [number, number], bbox_px: [cx - r, cy - r, cx + r, cy + r] as [number, number, number, number], area_px: Math.PI * r * r, max_span_px: 2 * r, span_endpoints_px: [[cx - r, cy], [cx + r, cy]] as [[number, number], [number, number]], perpendicular_span_px: 2 * r, obb: { length_px: 2 * r, width_px: 2 * r, angle_deg: 0 }, equivalent_diameter_px: 2 * r, solidity: 1, pieces: 1, touches_border: false, tiny: false, score, score_kind: "detector_confidence", polygons_px: [poly], flags: [], class: "weed" as const, fused_from_tiles: 1 };
  return {
    schema_version: "weed-vision-preview-result-1", run_id: "r", research_only: true,
    image: { filename: shot.filename, format: "JPEG", bytes: 1, width: NATIVE_W, height: NATIVE_H, exif: {}, coordinate_system: "original" },
    processing: { scale: 1, width: NATIVE_W, height: NATIVE_H, tiles: 35, tile_px: 1024, overlap_px: 256 },
    algorithm: { name: "rfdetr_seg_large", label: "RF-DETR Seg-Large", family: "rfdetr", benchmark: "", description: "", requested: "rfdetr_seg_large", model: "rfdetr" },
    model: null, versions: { service: "s", lab: "l" }, classes: ["crop", "weed"], count: 1, instances: [inst], crop_instances: [], crop_regions_px: null,
    pixel_fractions: { weed: null, crop: null }, timings_ms: { total: 12 }, memory: { peak_working_set_mb: null }, warnings: [], measurement_note: "",
  };
}

function fakeDeps(sources: ScanSources, store = new Map<string, SavedFrameRun>()): FrameRunDeps & { saved: Map<string, SavedFrameRun>; detectMock: ReturnType<typeof vi.fn> } {
  const byName = new Map(sources.set!.shots.map(s => [s.filename, s]));
  const detect = vi.fn(async (_blob: Blob, filename: string, _opts, hooks: { onProgress?: (p: { phase: "running"; tilesDone: number; tilesTotal: number; elapsedMs: number }) => void }) => {
    hooks.onProgress?.({ phase: "running", tilesDone: 10, tilesTotal: 35, elapsedMs: 5 });
    return { ok: true as const, value: resultAt(byName.get(filename)!, CENTRE) };
  });
  return {
    detect: detect as unknown as FrameRunDeps["detect"],
    detectMock: detect,
    download: async () => new Blob([new Uint8Array(4)], { type: "image/jpeg" }),
    cache: {
      // Keyed like the table: a different run key is a different cache.
      load: async (_scanId, paramsKey) => new Map([...store.entries()].filter(([k]) => k.startsWith(`${paramsKey}|`)).map(([k, v]) => [k.slice(paramsKey.length + 1), v])),
      save: async ({ paramsKey, run }) => { store.set(`${paramsKey}|${run.filename}`, run); return { ok: true }; },
      remove: async (_scanId, paramsKey) => { for (const k of [...store.keys()]) if (k.startsWith(`${paramsKey}|`)) store.delete(k); return { ok: true }; },
    },
    saved: store,
  };
}

const PARAMS = { algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, scale: 1 };
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => resetFrameRunStore());
afterEach(() => { resetFrameRunStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("frameRunStore", () => {
  it("lists only shots with a kept original", () => {
    const s = sourcesWithFrames(2);
    expect(scorableFrames(s)).toHaveLength(2);
    expect(scorableFrames({ ...s, frames: null })).toHaveLength(0);
    expect(scorableFrames(null)).toHaveLength(0);
  });

  it("scores every photo, merges the plant seen from all of them, saves per photo and reports progress", async () => {
    const sources = sourcesWithFrames(3);
    const deps = fakeDeps(sources);
    startFrameRun("scan-1", { userId: "u", sources, params: PARAMS, algorithmLabel: "RF-DETR Seg-Large", modelSha: "abc", deps });
    expect(getFrameRun("scan-1").running).toBe(true);
    await waitFor(() => expect(getFrameRun("scan-1").running).toBe(false));
    const s = getFrameRun("scan-1");
    expect(deps.detectMock).toHaveBeenCalledTimes(3);
    expect(deps.detectMock.mock.calls[0][2]).toMatchObject({ algorithm: "rfdetr_seg_large", threshold: 0.5, tile: 1024, overlap: 256, includeCrop: true });
    expect(s.raw).toBe(3);
    expect(s.plants).toHaveLength(1); // one plant, three sightings
    expect(s.plants[0].seenIn).toHaveLength(3);
    expect(s.progress).toMatchObject({ framesDone: 3, framesTotal: 3, current: null });
    expect(Object.values(s.frames).every(f => f.status === "done" && f.weeds === 1)).toBe(true);
    expect(s.note).toMatch(/^1 weed and 0 crop plants from 3 photos; 2 repeat sightings merged\.$/);
    expect(s.paramsKey).toBe(frameRunKey(PARAMS, "abc"));
    await flush();
    expect(deps.saved.size).toBe(3);
  });

  it("takes saved photos from the cache instead of the service, and restores a saved run", async () => {
    const sources = sourcesWithFrames(2);
    const first = fakeDeps(sources);
    startFrameRun("scan-2", { userId: "u", sources, params: PARAMS, algorithmLabel: "RF-DETR Seg-Large", modelSha: "abc", deps: first });
    await waitFor(() => expect(getFrameRun("scan-2").running).toBe(false));
    await flush();
    resetFrameRunStore();
    const second = fakeDeps(sources, first.saved);
    startFrameRun("scan-2", { userId: "u", sources, params: PARAMS, algorithmLabel: "RF-DETR Seg-Large", modelSha: "abc", deps: second });
    await waitFor(() => expect(getFrameRun("scan-2").running).toBe(false));
    expect(second.detectMock).not.toHaveBeenCalled();
    expect(getFrameRun("scan-2").plants).toHaveLength(1);
    expect(Object.values(getFrameRun("scan-2").frames).every(f => f.status === "cached")).toBe(true);
    resetFrameRunStore();
    expect(await restoreFrameRun("scan-2", { sources, params: PARAMS, modelSha: "abc", algorithmLabel: "RF-DETR Seg-Large", deps: second })).toBe(true);
    expect(getFrameRun("scan-2").plants).toHaveLength(1);
    expect(getFrameRun("scan-2").restoredAt).not.toBeNull();
    expect(await restoreFrameRun("scan-2", { sources, params: { ...PARAMS, threshold: 0.3 }, modelSha: "abc", algorithmLabel: "x", deps: second })).toBe(false);
  });

  it("stops when asked and keeps what it had; a service that is not reachable ends the run with its message", async () => {
    const sources = sourcesWithFrames(3);
    const deps = fakeDeps(sources);
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    const slow = vi.fn(async (blob, name, opts, hooks) => { await gate; return deps.detect(blob, name, opts, hooks); });
    startFrameRun("scan-3", { userId: "u", sources, params: PARAMS, algorithmLabel: "m", modelSha: null, deps: { ...deps, detect: slow as never } });
    await flush();
    stopFrameRun("scan-3");
    release();
    await flush();
    expect(getFrameRun("scan-3").running).toBe(false);
    expect(getFrameRun("scan-3").note).toMatch(/^Stopped\./);
    const down = { ...deps, detect: vi.fn(async () => ({ ok: false as const, error: "the research service is not reachable (x)" })) as never };
    startFrameRun("scan-4", { userId: "u", sources, params: PARAMS, algorithmLabel: "m", modelSha: null, deps: down });
    await waitFor(() => expect(getFrameRun("scan-4").running).toBe(false));
    expect(getFrameRun("scan-4").error).toMatch(/not reachable/);
  });

  it("says so when no originals were kept", () => {
    const sources = { ...sourcesWithFrames(1), frames: null };
    startFrameRun("scan-5", { userId: "u", sources, params: PARAMS, algorithmLabel: "m", modelSha: null, deps: fakeDeps(sources) });
    expect(getFrameRun("scan-5").running).toBe(false);
    expect(getFrameRun("scan-5").error).toMatch(/no original photographs were kept/);
  });
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const HEALTH = { ok: true, service: "s", lab: "l", research_only: true, model: { loaded: false, checkpoint_path: "e", checkpoint_sha256: null, load_ms: null, error: "missing", threads: 2, licence_note: "" }, models: { erfnet: { loaded: false, checkpoint_path: "e", checkpoint_sha256: null, load_ms: null, error: "missing", licence_note: "" }, rfdetr: { loaded: true, checkpoint_path: "r", checkpoint_sha256: "f605a1e7797e8122...", load_ms: 1, error: null, licence_note: "", device: "cuda" } }, limits: { max_megapixels: 120, max_mb: 120, min_side_px: 64 }, defaults: { algorithm: "selected", selected: "erfnet_erode1", scale: 1, tile: 1024, overlap: 128, threshold: 0.5 } };
const ALGS = { selected: { label: "Selected", family: "erfnet", needs_model: true, model: "erfnet", benchmark: "", description: "", alias_of: "erfnet_erode1" }, erfnet_erode1: { label: "ERFNet + 1 px erosion", family: "erfnet", needs_model: true, model: "erfnet", benchmark: "", description: "" }, rfdetr_seg_large: { label: "RF-DETR Seg-Large instance masks (Experiment 7)", family: "rfdetr", needs_model: true, model: "rfdetr", benchmark: "", description: "One mask per plant.", default_threshold: 0.5 } };

describe("ModelDetectionsPanel", () => {
  it("offers the service's algorithms, disables the ones without a model, and runs over the kept photos", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return jsonResponse(HEALTH);
      if (url.endsWith("/algorithms")) return jsonResponse({ selected: "erfnet_erode1", algorithms: ALGS });
      return jsonResponse({ error: "unexpected" }, 500);
    });
    localStorage.clear();
    const sources = sourcesWithFrames(2);
    render(<ModelDetectionsPanel taskId="scan-p" userId="u" sources={sources} fetchImpl={fetchMock as unknown as typeof fetch} />);
    const select = (await screen.findByTestId("model-select")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    const erf = Array.from(select.options).find(o => o.value === "erfnet_erode1")!;
    expect(erf.disabled).toBe(true);
    expect(select.value).toBe("rfdetr_seg_large");
    expect(screen.getByTestId("threshold")).toBeInTheDocument();
    expect(screen.getByTestId("run-frames")).toHaveTextContent("Run on 2 photos");
    expect(screen.queryByTestId("service-error")).toBeNull();
  });

  it("explains when the service is down and when nothing was kept", async () => {
    const down = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    render(<ModelDetectionsPanel taskId="scan-q" userId="u" sources={{ ...sourcesWithFrames(1), frames: null }} fetchImpl={down as unknown as typeof fetch} />);
    expect(await screen.findByTestId("service-error")).toHaveTextContent(/not running/);
    const btn = screen.getByTestId("run-frames") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn).toHaveTextContent("Run on 0 photos");
  });

  it("shows a finished run's counts and the map toggles", async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/health") ? jsonResponse(HEALTH) : jsonResponse({ selected: "erfnet_erode1", algorithms: ALGS }));
    const sources = sourcesWithFrames(2);
    const deps = fakeDeps(sources);
    render(<ModelDetectionsPanel taskId="scan-r" userId="u" sources={sources} fetchImpl={fetchMock as unknown as typeof fetch} />);
    await screen.findByTestId("model-select");
    await act(async () => { startFrameRun("scan-r", { userId: "u", sources, params: PARAMS, algorithmLabel: "RF-DETR", modelSha: "abc", deps }); });
    await waitFor(() => expect(getFrameRun("scan-r").running).toBe(false));
    expect(await screen.findByTestId("frame-summary")).toHaveTextContent(/1 weeds · 0 crop plants · 2 photos · 1 repeat sightings merged/);
    const crops = screen.getByLabelText(/Crop plants on the map/) as HTMLInputElement;
    expect(crops.checked).toBe(false);
    fireEvent.click(crops);
    expect(getFrameRun("scan-r").showCrops).toBe(true);
  });
});

describe("addFrameDetections (the closer look's single photo)", () => {
  it("places one photo's instances on the map, merges with the scan's other photos, and saves the photo", async () => {
    const sources = sourcesWithFrames(2);
    const deps = fakeDeps(sources);
    const [a, b] = scorableFrames(sources).map(f => f.shot);
    const first = await addFrameDetections("scan-s", { userId: "u", sources, shot: a, result: resultAt(a, CENTRE, 0.6), params: PARAMS, modelSha: "abc", algorithmLabel: "RF-DETR", deps });
    expect(first).toHaveLength(1);
    expect(getFrameRun("scan-s").plants).toHaveLength(1);
    expect(getFrameRun("scan-s").frames[a.filename]).toMatchObject({ status: "done", weeds: 1 });
    await addFrameDetections("scan-s", { userId: "u", sources, shot: b, result: resultAt(b, CENTRE, 0.9), params: PARAMS, modelSha: "abc", algorithmLabel: "RF-DETR", deps });
    const s = getFrameRun("scan-s");
    expect(s.raw).toBe(2);
    expect(s.plants).toHaveLength(1); // the same plant from the second photo merged into the first
    expect(s.plants[0].seenIn).toHaveLength(2);
    expect(s.paramsKey).toBe(frameRunKey(PARAMS, "abc"));
    await flush();
    expect(deps.saved.size).toBe(2);
    // A scan that cannot place photos says so with null and leaves the map alone.
    expect(await addFrameDetections("scan-t", { userId: null, sources: { ...sources, groundAltM: null }, shot: a, result: resultAt(a, CENTRE), params: PARAMS, modelSha: null, algorithmLabel: "x", deps })).toBeNull();
    expect(getFrameRun("scan-t").plants).toHaveLength(0);
  });

  it("hides plants that land outside the field boundary and counts them, before or after the boundary is known", async () => {
    const sources = sourcesWithFrames(1);
    const deps = fakeDeps(sources);
    const [a] = scorableFrames(sources).map(f => f.shot);
    const d = 0.00002; // about 2 m
    const around = (c: { lat: number; lng: number }) => [{ lat: c.lat - d, lng: c.lng - d }, { lat: c.lat - d, lng: c.lng + d }, { lat: c.lat + d, lng: c.lng + d }, { lat: c.lat + d, lng: c.lng - d }];
    const far = { lat: CENTRE.lat + 0.0005, lng: CENTRE.lng };
    await addFrameDetections("scan-b", { userId: null, sources, shot: a, result: resultAt(a, CENTRE), params: PARAMS, modelSha: null, algorithmLabel: "m", deps });
    expect(getFrameRun("scan-b").plants).toHaveLength(1);
    setFrameRunBoundary("scan-b", [around(far)]); // a boundary that does not contain the plant
    expect(getFrameRun("scan-b").plants).toHaveLength(0);
    expect(getFrameRun("scan-b").outside).toBe(1);
    setFrameRunBoundary("scan-b", [around(CENTRE)]);
    expect(getFrameRun("scan-b").plants).toHaveLength(1);
    expect(getFrameRun("scan-b").outside).toBe(0);
    setFrameRunBoundary("scan-b", null);
    expect(getFrameRun("scan-b").plants).toHaveLength(1);
  });
});
