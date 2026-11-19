// Photo ground (photoGround.ts): the flight's photographs laid on the ground through the build's cameras. Tested on
// synthetic nadir photographs cut from one rendered field, so the right answer is known pixel for pixel; and on the
// real corn test flight, that asking for it leaves the twin exactly as it was.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderScene, type Scene as RenderScene } from "../../scripts/cropProfiles/scenes";
import { nodeCodec, nodePhoto } from "../../scripts/directGeoref/nodePhotos";
import { IDENTITY, enuFromCamera, groundToPixel, mulM, pixelToGround, type GeorefFrame, type M3 } from "@/lib/directGeoref/projection";
import { fromEnu } from "@/lib/sourceFrames/odm";
import { buildFieldTwin } from "@/lib/fieldTwin/build/pipeline";
import { BACKGROUND, type GroundManifest, TILE, latOfY, lngOfX, overviewGround, parentTile, parseGroundManifest, solveGains, viewsOf } from "@/lib/fieldTwin/photoGround";

const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, { rotation: IDENTITY, basis: "t" });
const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
const NADIR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const ORIGIN = { lat: 40, lng: -90, altM: 0 };

// Three nadir photographs, 2 cm pixels, overlapping along north-south, cut from one rendered field.
const GSD = 0.02, W = 400, H = 300, OFFS = [0, 150, 300];
const sc: RenderScene = { name: "t", widthM: W * GSD, heightM: (OFFS[2] + H) * GSD, gsdM: GSD, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.16, leafM: 0.15, soil: "dark", straw: null, weedsPerM2: 3, weedRadiusM: 0.05, inRowWeedsPerM: 0, seed: 7 };
const field = renderScene(sc).px;
const cut = (oy: number, gain = 1) => { const rgba = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W * 4; x++) { const v = field.rgba[((oy + y) * field.width) * 4 + x]; rgba[y * W * 4 + x] = (x & 3) === 3 ? 255 : Math.min(255, v * gain); } return { width: W, height: H, rgba }; };
const frames = new Map<string, GeorefFrame>();
OFFS.forEach((oy, i) => {
  const name = `p${i}`, e = (W / 2) * GSD, n = -(oy + H / 2) * GSD, p = fromEnu([e, n, 0], ORIGIN);
  frames.set(name, { name, intrinsics: { width: W, height: H, fx: 10 / GSD, fy: 10 / GSD, cx: W / 2, cy: H / 2, distortion: null, basis: "t" }, pose: { lat: p.lat, lng: p.lng, altM: 10, datum: "t", attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "t" }, ground: { kind: "flat", altM: 0, datum: "t", basis: "t" } });
});
// The ground truth: the field's own pixel under a latitude/longitude.
const truthAt = (lat: number, lng: number) => {
  const kE = Math.cos((ORIGIN.lat * Math.PI) / 180) * 6378137 * (Math.PI / 180), kN = 6378137 * (Math.PI / 180);
  const e = (lng - ORIGIN.lng) * kE, n = (lat - ORIGIN.lat) * kN, x = Math.floor(e / GSD), y = Math.floor(-n / GSD);
  if (x < 0 || y < 0 || x >= field.width || y >= field.height) return null;
  const o = (y * field.width + x) * 4; return [field.rgba[o], field.rgba[o + 1], field.rgba[o + 2]];
};
const encodeRaw = async (rgba: Uint8Array) => rgba.slice();
async function collect(pixels: (n: string) => Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null>) {
  const tiles = new Map<string, Uint8Array>(); let manifest: GroundManifest | null = null; const order: string[] = [];
  for await (const f of overviewGround("t", frames, pixels, encodeRaw)) {
    order.push(f.file);
    if (f.file.endsWith(".json")) manifest = parseGroundManifest(JSON.parse(new TextDecoder().decode(f.bytes as Uint8Array)));
    else tiles.set(f.file, f.bytes as Uint8Array);
  }
  return { tiles, manifest: manifest!, order };
}

describe("photo ground on synthetic photographs", () => {
  it("checks the cameras the test is built on: a ground point and its pixel agree both ways", () => {
    const f = frames.get("p1")!, g = pixelToGround(f, 100, 80)!, h = groundToPixel(f, g.lat, g.lng, 0)!;
    expect(Math.hypot(h.u - 100, h.v - 80)).toBeLessThan(0.01);
  });

  it("lays the photographs on the ground as the field is: the overview's pixels are the field's own", async () => {
    const { tiles, manifest, order } = await collect(async n => cut(OFFS[Number(n.slice(1))]));
    expect(order[order.length - 1]).toBe("ground/ground.json");
    expect(manifest.frames.map(f => f.name)).toEqual(["p0", "p1", "p2"]);
    expect(manifest.gains.length).toBe(9);
    const z = manifest.overview.zoom;
    let n = 0, diff = 0, background = 0;
    for (const [file, rgba] of tiles) {
      const [, zz, xs, ys] = /ground\/(\d+)\/(\d+)\/(\d+)\.jpg/.exec(file)!.map(Number);
      if (zz !== z) continue;
      for (let py = 8; py < TILE; py += 16) for (let px = 8; px < TILE; px += 16) {
        const lat = latOfY(ys + (py + 0.5) / TILE, z), lng = lngOfX(xs + (px + 0.5) / TILE, z), want = truthAt(lat, lng), o = (py * TILE + px) * 4;
        if (!want) { if (rgba[o] === BACKGROUND[0] && rgba[o + 1] === BACKGROUND[1]) background++; continue; }
        // Away from the field's edge (a photograph's last pixel is half a sample).
        const k = Math.cos((ORIGIN.lat * Math.PI) / 180) * 6378137 * (Math.PI / 180), e = (lng - ORIGIN.lng) * k;
        if (e < 0.1 || e > W * GSD - 0.1) continue;
        n++; diff += Math.abs(rgba[o] - want[0]) + Math.abs(rgba[o + 1] - want[1]) + Math.abs(rgba[o + 2] - want[2]);
      }
    }
    expect(n).toBeGreaterThan(200);
    // Bilinear resampling of a 2 cm field at the overview's pixel: close, never another place.
    expect(diff / n / 3).toBeLessThan(25);
    expect(background).toBeGreaterThan(0);
  }, 60_000);

  it("balances a photograph exposed brighter than its neighbours", async () => {
    const plain = await collect(async n => cut(OFFS[Number(n.slice(1))]));
    const bright = await collect(async n => cut(OFFS[Number(n.slice(1))], n === "p1" ? 1.3 : 1));
    for (const c of [0, 1, 2]) expect(plain.manifest.gains[3 + c]).toBeCloseTo(1, 1);
    // p1's gain comes down by about the factor it was brightened, relative to its neighbours.
    const rel = bright.manifest.gains[3 + 1] / ((bright.manifest.gains[1] + bright.manifest.gains[7]) / 2);
    expect(rel).toBeGreaterThan(0.7); expect(rel).toBeLessThan(0.85);
  }, 60_000);

  it("finds the photographs that saw a place, nearest nadir first, at the place's own pixel", () => {
    // Row 140 of p1 is row 290 of the field: inside p0 (rows 0-300) and p1 (150-450), not p2 (300-600).
    const f1 = frames.get("p1")!, g = pixelToGround(f1, 200, 140)!;
    const views = viewsOf([...frames.values()], g.lat, g.lng);
    expect(views[0].name).toBe("p1");
    expect(Math.hypot(views[0].u - 200, views[0].v - 140)).toBeLessThan(0.05);
    expect(views.map(v => v.name)).toEqual(["p1", "p0"]);
    for (const v of views) { const back = pixelToGround(frames.get(v.name)!, v.u, v.v)!; expect(Math.hypot((back.lat - g.lat) * 110574, (back.lng - g.lng) * 85000)).toBeLessThan(0.01); }
    // Off every footprint: no photograph.
    expect(viewsOf([...frames.values()], g.lat, g.lng + 0.001)).toEqual([]);
  });

  it("averages four tiles into their parent and keeps the background where a child is missing", () => {
    const red = new Uint8Array(TILE * TILE * 4).fill(200);
    const p = parentTile([red, null, null, red], TILE);
    expect(p[0]).toBe(200); expect(p[(TILE - 1) * 4]).toBe(BACKGROUND[0]);
  });

  it("solves no gain from overlaps too small to say", () => {
    expect(Array.from(solveGains(2, new Map([["0:1", { a: 0, b: 1, n: 10, sa: new Float64Array([10, 10, 10]), sb: new Float64Array([20, 20, 20]) }]])))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("refuses a manifest that is not one, or whose gains do not match its photographs", () => {
    expect(parseGroundManifest({ format: "x" })).toBeNull();
    expect(parseGroundManifest({ format: "swardus-photo-ground-v1", overview: {}, detail: {}, frames: [{}], gains: [1, 1] })).toBeNull();
  });
});

const FLIGHT = "D:/swardus-research/cornflight/Day023_Corn1-n40";
const haveFlight = existsSync(FLIGHT) && readdirSync(FLIGHT).filter(f => /\.jpe?g$/i.test(f)).length >= 40;

describe.skipIf(!haveFlight)("photo ground in the real build", () => {
  it("asked for, leaves the twin and its files byte for byte as they were, and hands the overview apart", { timeout: 600_000 }, async () => {
    const pick = ["746.JPG", "745.JPG", "747.JPG"];
    const photos = () => pick.map(f => nodePhoto(join(FLIGHT, f)));
    const options = { name: "corn test", crop: "corn" as const, detector: null, weedTier: "none" as const, usePreview: false };
    const off = await buildFieldTwin(photos(), options, nodeCodec);
    const on = await buildFieldTwin(photos(), { ...options, photoGround: true }, nodeCodec);
    expect(off.cutGround).toBeNull();
    const strip = (t: unknown) => { const c = JSON.parse(JSON.stringify(t)); delete c.builtAt; return c; };
    expect(strip(on.twin)).toEqual(strip(off.twin));
    expect([...on.files.keys()]).toEqual([...off.files.keys()]);
    const got: string[] = [];
    let manifest: GroundManifest | null = null;
    for await (const f of on.cutGround!()) { got.push(f.file); if (f.file.endsWith(".json")) manifest = parseGroundManifest(JSON.parse(new TextDecoder().decode(f.bytes as Uint8Array))); }
    expect(got.length).toBeGreaterThan(1);
    expect(got[got.length - 1]).toBe("ground/ground.json");
    expect(got.every(f => f.startsWith("ground/"))).toBe(true);
    expect(manifest!.frames.length).toBe(pick.length);
    expect(manifest!.twinId).toBe(on.twin.id);
  });
});
