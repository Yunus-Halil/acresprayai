// Corn in the Field Twin (2026-11-04): the stored representation (a corn section, older twins unchanged), the corn
// stage of the build on a rendered field seen by overlapping cameras, the scene the map draws, and the real build
// pipeline on a few photographs of the UAV3DCrop corn test flight when it is on this computer (skipped elsewhere).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderScene, type Scene as RenderScene } from "../../scripts/cropProfiles/scenes";
import { nodeCodec, nodePhoto } from "../../scripts/directGeoref/nodePhotos";
import { cornStage } from "@/lib/fieldTwin/build/corn";
import { buildFieldTwin } from "@/lib/fieldTwin/build/pipeline";
import { stagesFor, type PhotoSource } from "@/lib/fieldTwin/build/types";
import { buildScene } from "@/lib/fieldTwin/scene";
import { parseTwin, type TwinBundle } from "@/lib/fieldTwin/types";
import { CORN_TWIN, cornEvidence as ev } from "./fixtures/cornTwin";
import { IDENTITY, enuFromCamera, mulM, type GeorefFrame, type M3 } from "@/lib/directGeoref/projection";
import { fromEnu } from "@/lib/sourceFrames/odm";
import type { PhotoPixels } from "@/lib/photoScout/pattern";

describe("the stored corn twin", () => {
  it("parses a corn twin, and refuses a malformed corn section with the reason", () => {
    expect(parseTwin(JSON.parse(JSON.stringify(CORN_TWIN))).ok).toBe(true);
    const bad = (patch: (t: TwinBundle) => void) => { const t = JSON.parse(JSON.stringify(CORN_TWIN)) as TwinBundle; patch(t); const r = parseTwin(t); return "reason" in r ? r.reason : null; };
    expect(bad(t => { (t.corn!.weeds[0] as { status: string }).status = "verified"; })).toMatch(/corn: weed 1 has an unknown status/);
    expect(bad(t => { t.corn!.rows[0].line = [[40, -90]]; })).toMatch(/corn: row 1 has no line/);
    expect(bad(t => { t.corn!.gaps[0].evidence = [ev(4)]; })).toMatch(/corn: gap 1: evidence points at atlas 4/);
    expect(bad(t => { (t.corn as unknown as { enteredCrop: string }).enteredCrop = "beet"; })).toMatch(/entered crop is not corn/);
    expect(bad(t => { delete (t.corn!.weeds[0] as Partial<typeof t.corn.weeds[0]>).evidence; })).toMatch(/corn: weed 1 has no votes, coverage, reason or evidence list/);
    expect(bad(t => { delete (t.corn!.gaps[0] as Partial<typeof t.corn.gaps[0]>).plantSeenBy; })).toMatch(/corn: gap 1 has no row, reason, photograph lists/);
  });

  it("leaves an older twin without a corn section exactly as it was", () => {
    const t = JSON.parse(JSON.stringify(CORN_TWIN)) as TwinBundle;
    delete t.corn; delete t.source.placement;
    const r = parseTwin(t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.twin.corn).toBeUndefined();
    const s = buildScene(r.twin);
    expect(s.corn).toBeNull();
    expect(s.rows.n).toBe(1);
  });

  it("builds the map's corn arrays, and draws a corn twin's rows only through the corn layer", () => {
    const s = buildScene(CORN_TWIN);
    expect(s.corn!.rows.n).toBe(2);
    expect(Array.from(s.corn!.rows.status)).toEqual([1, 2]);
    expect(Array.from(s.corn!.weeds.status)).toEqual([1, 2]);
    expect(s.corn!.gaps.n).toBe(1);
    expect(s.rows.n).toBe(0);
  });

  it("lists the corn stage in place of the orchard's rows and weed passes", () => {
    const ids = stagesFor("corn").map(s => s.id);
    expect(ids).toContain("corn"); expect(ids).not.toContain("rows"); expect(ids).not.toContain("weeds");
    expect(stagesFor("orchard").map(s => s.id)).not.toContain("corn");
  });
});

// Three straight-down cameras over one rendered field, each seeing an overlapping window of it.
const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, { rotation: IDENTITY, basis: "t" });
const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
const NADIR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const ORIGIN = { lat: 40, lng: -90, altM: 0 };

describe("the corn stage over overlapping photographs", () => {
  const GSD = 0.005, W = 1600, H = 1000, OFFS = [0, 600, 1200];
  const sc: RenderScene = { name: "t", widthM: W * GSD, heightM: (OFFS[2] + H) * GSD, gsdM: GSD, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.16, leafM: 0.15, soil: "dark", straw: null, weedsPerM2: 0, weedRadiusM: 0.05, inRowWeedsPerM: 0, seed: 21 };
  const field = renderScene(sc).px;
  const cut = (oy: number): PhotoPixels => { const rgba = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) rgba.set(field.rgba.subarray(((oy + y) * field.width) * 4, ((oy + y) * field.width + W) * 4), y * W * 4); return { width: W, height: H, rgba }; };
  const frames = new Map<string, GeorefFrame>(), photos: PhotoSource[] = [];
  OFFS.forEach((oy, i) => {
    const name = `p${i}`, e = (W / 2) * GSD, n = -(oy + H / 2) * GSD, p = fromEnu([e, n, 0], ORIGIN);
    frames.set(name, { name, intrinsics: { width: W, height: H, fx: 10 / GSD, fy: 10 / GSD, cx: W / 2, cy: H / 2, distortion: null, basis: "t" }, pose: { lat: p.lat, lng: p.lng, altM: 10, datum: "t", attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "t" }, ground: { kind: "flat", altM: 0, datum: "t", basis: "t" } });
    const px = cut(oy);
    photos.push({ name, header: async () => new Uint8Array(), bytes: async () => new Uint8Array(), decode: async () => px, preview: async () => null, crops: async () => [] });
  });

  it("reads every photograph with Corn V1 and combines them: rows on the lattice, the photographs agreeing", { timeout: 120_000 }, async () => {
    const r = await cornStage(photos, frames);
    expect(r.reads.length).toBe(3);
    expect(r.failed).toEqual([]);
    expect(Math.abs(r.field.pitchM! - 0.762)).toBeLessThan(0.05);
    expect(r.field.rowAgreementM!).toBeLessThan(0.03);
    expect(r.field.rows.length).toBeGreaterThanOrEqual(8);
    // Rows the photographs all see are held by all three.
    expect(r.field.rows.some(x => x.seenBy === 3)).toBe(true);
  });
});

const FLIGHT = "D:/swardus-research/cornflight/Day023_Corn1-n40";
const haveFlight = existsSync(FLIGHT) && readdirSync(FLIGHT).filter(f => /\.jpe?g$/i.test(f)).length >= 40;

describe.skipIf(!haveFlight)("the real build on the UAV3DCrop corn test flight", () => {
  it("builds a corn twin from four overlapping photographs: a corn section, rows, local placement", { timeout: 300_000 }, async () => {
    const files = readdirSync(FLIGHT).filter(f => /\.jpe?g$/i.test(f)).sort();
    const pick = ["746.JPG", "745.JPG", "747.JPG", "744.JPG"].filter(f => files.includes(f));
    const out = await buildFieldTwin(pick.map(f => nodePhoto(join(FLIGHT, f))), { name: "corn test", crop: "corn", detector: null, weedTier: "none", usePreview: false }, nodeCodec);
    const parsed = parseTwin(JSON.parse(JSON.stringify(out.twin)));
    expect(parsed.ok).toBe(true);
    expect(out.twin.corn).toBeTruthy();
    expect(out.twin.corn!.rows.length).toBeGreaterThan(3);
    expect(out.twin.source.placement?.kind).toBe("local");
    expect(out.twin.weeds.length).toBe(0);
    expect(out.report.corn!.photographsRead).toBe(pick.length);
  });
});
