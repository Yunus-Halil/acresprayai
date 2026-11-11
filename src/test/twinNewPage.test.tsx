// The New Field Twin page: nothing builds before a crop and a usable set; the check is shown in plain words; only
// the photographs the check passed are handed to the build.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DjiPhotoMeta } from "@/lib/directGeoref/metadata";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", email: "ryan@farm.test" } }) }));
let who: "founder" | "participant" = "participant";
// The participant's newest agreement, as the page reads it (never the live project).
let agreedTo: string | null = "pilot-2026-11-v1";
vi.mock("@/lib/pilot/consent", async orig => ({ ...(await orig<typeof import("@/lib/pilot/consent")>()), loadConsent: async () => (agreedTo ? { terms_version: agreedTo, troubleshooting_access: true, research_use: false, created_at: "2026-11-11T00:00:00Z" } : null) }));
vi.mock("@/lib/pilot/access", () => ({ usePilotRole: () => who, usePilot: () => ({ access: { status: "member", serverRole: who, role: who, displayName: null } }) }));
vi.mock("@/lib/pilot/telemetry", () => ({ track: () => undefined }));
const startBuildSession = vi.fn();
vi.mock("@/lib/fieldTwin/buildSession", async orig => ({ ...(await orig<typeof import("@/lib/fieldTwin/buildSession")>()), startBuildSession: (...a: unknown[]) => startBuildSession(...a) }));

const meta = (over: Partial<DjiPhotoMeta> = {}): DjiPhotoMeta => ({
  make: "DJI", model: "FC6310R", width: 5472, height: 3648, focalMm: 8.8, focal35Mm: 24, capturedAt: "2026:06:01 10:00:00",
  lat: 38.9, lng: -76.9, positionSource: "xmp", absoluteAltitudeM: 80, relativeAltitudeM: 36, gimbalYawDeg: 0, gimbalPitchDeg: -90,
  gimbalRollDeg: 0, flightYawDeg: 0, flightPitchDeg: 0, flightRollDeg: 0, speedNorthMs: 0, speedEastMs: 0, speedDownMs: 0,
  calibratedFocalPx: 3666, opticalCenterX: 2736, opticalCenterY: 1824, dewarpFlag: 1, dewarpData: null,
  rtkFlag: null, rtkStdLonM: null, rtkStdLatM: null, rtkStdHgtM: null, ...over,
});
let headers: Record<string, DjiPhotoMeta> = {};
vi.mock("@/lib/fieldTwin/preflight", async orig => {
  const real = await orig<typeof import("@/lib/fieldTwin/preflight")>();
  return {
    ...real,
    readForCheck: async (files: File[]) => ({
      inputs: files.filter(f => /\.jpe?g$/i.test(f.name)).map(f => ({ name: f.name, path: f.name, size: f.size, meta: headers[f.name] ?? null })),
      otherFiles: files.filter(f => !/\.jpe?g$/i.test(f.name)).length,
    }),
  };
});

import TwinNew from "@/pages/app/TwinNew";

const pickFiles = async (names: string[]) => {
  const input = document.querySelector<HTMLInputElement>('input[type=file][multiple]')!;
  const list = names.map(n => new File(["x"], n));
  await act(async () => { fireEvent.change(input, { target: { files: list } }); });
  return list;
};

beforeEach(() => {
  who = "participant"; agreedTo = "pilot-2026-11-v1";
  startBuildSession.mockClear();
  headers = {};
  for (let k = 1; k <= 12; k++) headers[`DJI_${String(k).padStart(4, "0")}.JPG`] = meta({ lat: 38.9 + k * 0.0001, lng: -76.9 + (k % 4) * 0.0002 });
  headers["DJI_0013.JPG"] = meta({ lat: null, lng: null });
  // Browsers without these cannot build; jsdom has none of them.
  Object.assign(globalThis, { Worker: class {}, OffscreenCanvas: class {}, CompressionStream: class {}, createImageBitmap: () => undefined });
});

describe("New Field Twin", () => {
  it("cannot build before a crop is chosen and photographs are checked", () => {
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Build the Field Twin" })).toBeDisabled();
    expect(screen.getByText("Choose the crop first.")).toBeInTheDocument();
  });

  it("checks the photographs, says what it left out, and builds from the usable ones only", async () => {
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    fireEvent.click(screen.getByRole("radio", { name: /Corn/ }));
    const names = [...Object.keys(headers), "DJI_0014.MP4"];
    const list = await pickFiles(names);
    const check = await screen.findByLabelText("Photograph check");
    expect(check).toHaveTextContent("12 of 14 files can be used");
    expect(check).toHaveTextContent(/1 photograph left out: it has no position in the file/);
    expect(check).toHaveTextContent(/1 file skipped because it is not a JPEG photograph/);
    expect(check).toHaveTextContent(/about 1\.0 cm of ground per pixel/);
    expect(check).toHaveTextContent(/GPS \(a metre or a few\)/);
    const build = screen.getByRole("button", { name: "Build the Field Twin" });
    expect(build).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Field name/), { target: { value: "North block" } });
    fireEvent.click(build);
    expect(startBuildSession).toHaveBeenCalledOnce();
    const [given, opts] = startBuildSession.mock.calls[0] as [File[], Record<string, unknown>];
    expect(given.map(f => f.name)).toEqual(list.slice(0, 12).map(f => f.name));
    expect(opts).toMatchObject({ name: "North block", crop: "corn", weeds: "colour", userId: "u1" });
    // This participant agreed only to the earlier terms, which do not describe the analysis record: none is kept.
    expect(opts.analysis).toBe(false);
  });

  it("a participant who agreed to the terms in force has their corn build started with its analysis record", async () => {
    agreedTo = "pilot-2026-11-v2";
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    fireEvent.click(screen.getByRole("radio", { name: /Corn/ }));
    await pickFiles(Object.keys(headers));
    await screen.findByLabelText("Photograph check");
    fireEvent.click(screen.getByRole("button", { name: "Build the Field Twin" }));
    expect((startBuildSession.mock.calls[0] as [File[], Record<string, unknown>])[1]).toMatchObject({ crop: "corn", analysis: true });
  });

  it("the founder's own build is started with its analysis record", async () => {
    who = "founder";
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    fireEvent.click(screen.getByRole("radio", { name: /Corn/ }));
    await pickFiles(Object.keys(headers));
    await screen.findByLabelText("Photograph check");
    fireEvent.click(screen.getByRole("button", { name: "Build the Field Twin" }));
    expect(startBuildSession).toHaveBeenCalledOnce();
    expect((startBuildSession.mock.calls[0] as [File[], Record<string, unknown>])[1]).toMatchObject({ crop: "corn", userId: "u1", analysis: true });
  });

  it("a set that cannot make a twin is stopped, with the reason", async () => {
    headers = { "IMG_0001.JPG": meta({ relativeAltitudeM: null, gimbalPitchDeg: null, make: "Apple", model: "iPhone 15" }) };
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    fireEvent.click(screen.getByRole("radio", { name: /Orchard/ }));
    await pickFiles(["IMG_0001.JPG"]);
    expect(await screen.findByLabelText("Photograph check")).toHaveTextContent(/not from a DJI drone/);
    expect(screen.getByRole("button", { name: "Build the Field Twin" })).toBeDisabled();
    expect(screen.getByText("This set cannot be built: see above.")).toBeInTheDocument();
  });

  it("a participant gets no weed-pass choice", () => {
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    fireEvent.click(screen.getByRole("radio", { name: /Orchard/ }));
    expect(screen.queryByText(/Weed pass/)).toBeNull();
  });
});
