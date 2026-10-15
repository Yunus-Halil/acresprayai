// WEED-VISION-PREVIEW (temporary research integration; remove with the branch).
// Flag enforcement, the never-throwing client, export, comparison, overlay rendering
// and the upload-to-overlay workflow of the page against a mocked service.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { isWeedVisionPreviewEnabled, WEED_VISION_API_BASE } from "@/lib/weedVision/flag";
import { detectWeeds, fetchHealth, instanceAt, type WeedVisionResult } from "@/lib/weedVision/client";
import { resultToCsv, summaryToCsv, INSTANCE_CSV_COLUMNS } from "@/lib/weedVision/export";
import { compareRuns } from "@/lib/weedVision/compare";
import { WeedOverlay } from "@/components/app/weedVision/WeedOverlay";
import WeedVisionPreview from "@/pages/app/WeedVisionPreview";

const inst = (id: number, cx: number, cy: number, r: number): WeedVisionResult["instances"][number] => ({
  id, centroid_px: [cx, cy], bbox_px: [cx - r, cy - r, cx + r, cy + r], area_px: Math.PI * r * r, max_span_px: 2 * r,
  span_endpoints_px: [[cx - r, cy], [cx + r, cy]], perpendicular_span_px: 2 * r, obb: { length_px: 2 * r, width_px: 2 * r, angle_deg: 0 },
  equivalent_diameter_px: 2 * r, solidity: 0.9, pieces: 1, touches_border: false, tiny: r < 3, score: 0.9, score_kind: "mean_weed_probability",
  polygons_px: [[[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]], flags: [],
});

const result = (over: Partial<WeedVisionResult> = {}): WeedVisionResult => ({
  schema_version: "weed-vision-preview-result-1", run_id: "abc", research_only: true,
  image: { filename: "DJI_0001.JPG", format: "JPEG", bytes: 1000, width: 400, height: 300, exif: {}, coordinate_system: "original image pixels" },
  processing: { scale: 1, width: 400, height: 300, tiles: 1, tile_px: 1024, overlap_px: 128 },
  algorithm: { name: "erfnet_erode1", label: "ERFNet + 1 px erosion", family: "erfnet", benchmark: "reports/postprocess/S3_erode_1", description: "d", requested: "selected" },
  model: { loaded: true, checkpoint_path: "x", checkpoint_sha256: "0625...", load_ms: 50, error: null, threads: 6, licence_note: "research" },
  versions: { service: "svc", lab: "lab" }, count: 2, instances: [inst(1, 100, 100, 20), inst(2, 300, 200, 30)], crop_regions_px: [[[10, 10], [50, 10], [50, 50]]],
  pixel_fractions: { weed: 0.01, crop: 0.1 }, timings_ms: { total: 123, inference_forward: 100, components: 3, geometry_and_polygons: 5 }, memory: { peak_working_set_mb: 400 },
  warnings: ["colour algorithm: it finds vegetation"], measurement_note: "pixel units only", ...over,
});

describe("flag", () => {
  it("is on only in a dev build with the variable set", () => {
    expect(isWeedVisionPreviewEnabled({ DEV: true, VITE_WEED_VISION_PREVIEW: "true" })).toBe(true);
    expect(isWeedVisionPreviewEnabled({ DEV: false, VITE_WEED_VISION_PREVIEW: "true" })).toBe(false);
    expect(isWeedVisionPreviewEnabled({ DEV: true, VITE_WEED_VISION_PREVIEW: "1" })).toBe(false);
    expect(isWeedVisionPreviewEnabled({ DEV: true })).toBe(false);
    expect(WEED_VISION_API_BASE).toBe("/weed-vision-api");
  });
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("client", () => {
  it("never throws when the service is down", async () => {
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const h = await fetchHealth(f);
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.error).toMatch(/not reachable/);
    const d = await detectWeeds(new Blob(["x"]), "a.jpg", { algorithm: "selected", scale: 1 }, { fetchImpl: f });
    expect(d.ok).toBe(false);
  });
  it("polls the job endpoint and reports progress", async () => {
    const calls: string[] = [];
    let polls = 0;
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/detect")) return jsonResponse({ job_id: "j1", state: "queued" }, 202);
      polls += 1;
      if (polls < 2) return jsonResponse({ state: "running", progress: { tiles_done: 3, tiles_total: 12 } });
      return jsonResponse({ state: "done", progress: { tiles_done: 12, tiles_total: 12 }, result: result() });
    }) as unknown as typeof fetch;
    const seen: string[] = [];
    const out = await detectWeeds(new Blob(["x"]), "a.jpg", { algorithm: "selected", scale: 1 }, { fetchImpl: f, pollMs: 1, onProgress: p => seen.push(`${p.phase}:${p.tilesDone}`) });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.count).toBe(2);
    expect(calls[0]).toBe("/weed-vision-api/detect");
    expect(calls[1]).toBe("/weed-vision-api/jobs/j1");
    expect(seen).toContain("running:3");
    expect(seen[seen.length - 1]).toBe("done:12");
  });
  it("surfaces a 503 missing-checkpoint error", async () => {
    const f = vi.fn(async () => jsonResponse({ error: "ERFNet checkpoint unavailable: missing" }, 503)) as unknown as typeof fetch;
    const out = await detectWeeds(new Blob(["x"]), "a.jpg", { algorithm: "erfnet_erode1", scale: 1 }, { fetchImpl: f });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/checkpoint/);
  });
  it("finds the instance under a click by polygon, then by centroid radius", () => {
    const r = result();
    expect(instanceAt(r.instances, 100, 100)?.id).toBe(1);
    expect(instanceAt(r.instances, 318, 215)?.id).toBe(2);
    expect(instanceAt(r.instances, 300, 245)).toBeNull(); // 15 px below the box and 45 px from the centroid: nothing
    expect(instanceAt(r.instances, 300, 215)?.id).toBe(2); // inside the polygon
    expect(instanceAt(r.instances, 10, 290)).toBeNull();
  });
});

describe("export", () => {
  it("writes one CSV row per instance with the documented columns and escapes commas", () => {
    const r = result();
    r.instances[0].flags = ["touches image border, span lower bound"];
    const csv = resultToCsv(r);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toMatch(/^# Weed Vision/);
    expect(lines[2]).toBe(INSTANCE_CSV_COLUMNS.join(","));
    expect(lines.length).toBe(3 + 2);
    expect(lines[3]).toMatch(/^1,100,100,/);
    expect(lines[3]).toContain('"touches image border, span lower bound"');
    const s = summaryToCsv(r);
    expect(s).toContain("weed_count,2");
    expect(s).toContain("timing_ms_total,123");
  });
});

describe("compare", () => {
  it("pairs instances by proximity and reports the unpaired", () => {
    const a = result();
    const b = result({ instances: [inst(1, 103, 98, 22), inst(2, 50, 250, 10)], count: 2, timings_ms: { total: 50 } });
    const c = compareRuns(a, b);
    expect(c.pairs.length).toBe(1);
    expect(c.pairs[0].a.id).toBe(1);
    expect(c.onlyA.map(i => i.id)).toEqual([2]);
    expect(c.onlyB.map(i => i.id)).toEqual([2]);
    expect(c.countDiff).toBe(0);
    expect(c.runtimeMsB).toBe(50);
  });
});

describe("overlay", () => {
  it("renders a polygon per instance, numbers, crops, and a selected span line", () => {
    const r = result();
    const { container } = render(<svg>
      <WeedOverlay instances={r.instances} outlines fills numbers selectedId={2} cropRegions={r.crop_regions_px} showCrops />
    </svg>);
    expect(container.querySelectorAll("[data-instance-id]").length).toBe(2);
    expect(container.querySelectorAll("polygon").length).toBe(3); // 2 instances + 1 crop region
    expect(container.querySelectorAll("text").length).toBe(2);
    expect(container.querySelector('[data-instance-id="2"] line')).not.toBeNull();
    expect(container.querySelector('[data-instance-id="1"] line')).toBeNull();
    const poly = container.querySelector('[data-instance-id="1"] polygon') as SVGPolygonElement;
    expect(poly.getAttribute("points")).toBe("80,80 120,80 120,120 80,120");
  });
});

describe("page", () => {
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:photo");
    URL.revokeObjectURL = vi.fn();
    // jsdom does not decode images: make every <img> report 400 x 300 and fire onload.
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 300 });
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", { configurable: true, set(v: string) { desc.set!.call(this, v); setTimeout(() => this.onload?.(new Event("load")), 0); }, get() { return desc.get!.call(this); } });
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return jsonResponse({ ok: true, service: "svc", lab: "lab", research_only: true, model: { loaded: true, checkpoint_path: "x", checkpoint_sha256: "0625", load_ms: 1, error: null, threads: 6, licence_note: "" }, limits: { max_megapixels: 120, max_mb: 120, min_side_px: 64 }, defaults: { algorithm: "selected", selected: "erfnet_erode1", scale: 1, tile: 1024, overlap: 128 } });
      if (url.endsWith("/algorithms")) return jsonResponse({ selected: "erfnet_erode1", algorithms: { erfnet_erode1: { label: "ERFNet + 1 px erosion", family: "erfnet", needs_model: true, benchmark: "b", description: "d" }, exg_fixed_0_08: { label: "ExG", family: "colour", needs_model: false, benchmark: "b", description: "d" } } });
      if (url.endsWith("/detect")) return jsonResponse(result());
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke; vi.unstubAllGlobals(); });

  it("shows the research banner and runs upload -> detect -> overlay -> select -> clear", async () => {
    render(<WeedVisionPreview />);
    expect(screen.getByTestId("research-banner")).toHaveTextContent(/Research preview/);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const input = screen.getByTestId("weed-vision-file") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "DJI_0001.JPG", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId("photo-viewer")).toBeInTheDocument());
    const detect = screen.getByTestId("weed-vision-detect") as HTMLButtonElement;
    await waitFor(() => expect(detect.disabled).toBe(false));
    fireEvent.click(detect);
    await waitFor(() => expect(screen.getByTestId("weed-vision-count")).toHaveTextContent("2 weeds predicted"));
    const overlay = screen.getByTestId("weed-vision-overlay");
    expect(overlay.querySelectorAll("[data-instance-id]").length).toBe(2);
    expect(screen.getByTestId("weed-vision-warnings")).toHaveTextContent(/colour algorithm/);
    // select from the table, inspect, then clear
    const table = screen.getByTestId("weed-vision-table");
    fireEvent.click(within(table).getAllByRole("row")[2]);
    await waitFor(() => expect(screen.getByTestId("weed-vision-instance")).toHaveTextContent(/max span/));
    expect(overlay.querySelector('[data-instance-id="2"][data-selected="1"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("weed-vision-clear"));
    await waitFor(() => expect(screen.queryByTestId("weed-vision-count")).toBeNull());
    expect(screen.getByTestId("photo-viewer")).toBeInTheDocument(); // the photo stays
  });

  it("reports a service error instead of crashing", async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith("/detect") ? jsonResponse({ error: "ERFNet checkpoint unavailable" }, 503) : jsonResponse({ ok: false, error: "down" }, 500));
    render(<WeedVisionPreview />);
    const file = new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("weed-vision-file"), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByTestId("weed-vision-detect") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("weed-vision-detect"));
    await waitFor(() => expect(screen.getByTestId("weed-vision-error")).toHaveTextContent(/checkpoint/));
  });
});
