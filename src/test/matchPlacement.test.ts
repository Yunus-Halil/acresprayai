// Photographs without GPS placed by matching (src/lib/fieldTwin/build/matchPlacement.ts): views cut from one
// synthetic ground at known turns and places come back at those turns and places, the made-up headers project
// through the real camera model the way the placement says, and the JPEG size is read from the frame header.
import { describe, expect, it } from "vitest";
import { frameFromDji, pixelToGround, takeoffPlane } from "@/lib/directGeoref";
import { type Pose, type Thumb, STAND_IN_ORIGIN, jpegSize, matchPairs, matchedMeta, overlapShare, solvePlacement } from "@/lib/fieldTwin/build/matchPlacement";
import { toEnu } from "@/lib/sourceFrames/odm";

/** A ground with texture at every scale (seeded): blobs of many sizes plus fine noise. */
function ground(size: number, seed = 7): { size: number; at: (x: number, y: number) => number } {
  let s = seed;
  // 32-bit arithmetic (Math.imul): a plain multiply loses the low bits past 2^53 and the sequence falls into a short cycle.
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const blobs = Array.from({ length: 900 }, () => ({ x: rnd() * size, y: rnd() * size, r: 2 + rnd() ** 2 * 30, v: rnd() * 2 - 1 }));
  const g = new Float32Array(size * size);
  for (const b of blobs) {
    const r2 = b.r * b.r;
    for (let y = Math.max(0, Math.floor(b.y - 3 * b.r)); y < Math.min(size, b.y + 3 * b.r); y++)
      for (let x = Math.max(0, Math.floor(b.x - 3 * b.r)); x < Math.min(size, b.x + 3 * b.r); x++) g[y * size + x] += b.v * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / r2);
  }
  for (let k = 0; k < g.length; k++) g[k] = 128 + 40 * g[k] + 10 * (rnd() - 0.5);
  const at = (x: number, y: number) => {
    const x0 = Math.max(0, Math.min(size - 2, Math.floor(x))), y0 = Math.max(0, Math.min(size - 2, Math.floor(y))), fx = x - x0, fy = y - y0;
    return (g[y0 * size + x0] * (1 - fx) + g[y0 * size + x0 + 1] * fx) * (1 - fy) + (g[(y0 + 1) * size + x0] * (1 - fx) + g[(y0 + 1) * size + x0 + 1] * fx) * fy;
  };
  return { size, at };
}

/** A view of the ground with the model's pose: thumbnail offset p (from its centre) shows ground t + R(phi) p. */
function view(name: string, G: ReturnType<typeof ground>, pose: Pose, W = 220, H = 165): Thumb {
  const grey = new Float32Array(W * H), c = Math.cos(pose.phi), s = Math.sin(pose.phi);
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const px = u - (W - 1) / 2, py = v - (H - 1) / 2;
    grey[v * W + u] = G.at(pose.x + c * px - s * py, pose.y + s * px + c * py);
  }
  return { name, width: W, height: H, grey };
}

const rad = (d: number) => (d * Math.PI) / 180;

describe("placement by matching", () => {
  it("reads a JPEG's pixel size from its frame header, past an APP segment", () => {
    const app = [0xff, 0xe1, 0x00, 0x06, 1, 2, 3, 4];
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0x74, 0x14, 0xa0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    expect(jpegSize(new Uint8Array([0xff, 0xd8, ...app, ...sof, 0, 0, 0]))).toEqual({ width: 5280, height: 3956 });
    expect(jpegSize(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBeNull();
  });

  it("measures the shared ground of two turned rectangles", () => {
    expect(overlapShare(100, 50, 100, 50, 0, 0, 0)).toBeCloseTo(1, 6);
    expect(overlapShare(100, 50, 100, 50, 0, 50, 0)).toBeCloseTo(0.5, 6);
    expect(overlapShare(100, 50, 100, 50, Math.PI, 0, 25)).toBeCloseTo(0.5, 6);
    expect(overlapShare(100, 50, 100, 50, 0, 200, 0)).toBe(0);
  });

  it("puts a serpentine flight back together: two passes, a turn, and a photograph that overlaps nothing", async () => {
    const G = ground(900);
    // Pass one up the ground (turn 0), pass two back beside it (turned half round, slightly off), one off on its own.
    const truth = new Map<string, Pose>();
    for (let k = 0; k < 6; k++) truth.set(`a${k}`, { phi: rad(0.5 * k), x: 300, y: 650 - 45 * k });
    truth.set("turn", { phi: rad(91), x: 360, y: 360 });
    for (let k = 0; k < 6; k++) truth.set(`b${k}`, { phi: rad(180 - 0.7 * k), x: 430, y: 410 + 45 * k });
    truth.set("lone", { phi: 0, x: 780, y: 120 });
    const thumbs = [...truth].map(([n, p]) => view(n, G, p));
    const pairs = await matchPairs(thumbs, { n: 256 });
    const solve = solvePlacement(thumbs.map(t => t.name), pairs);
    expect(solve.unjoined).toEqual(["lone"]);
    expect(solve.poses.size).toBe(13);
    // Compare in the first photograph's frame: the placement fixes its turn at 0 and its place at the origin.
    const t0 = truth.get("a0")!, s0 = solve.poses.get("a0")!;
    for (const [n, p] of solve.poses) {
      const t = truth.get(n)!;
      const dx = t.x - t0.x, dy = t.y - t0.y, c = Math.cos(-t0.phi), s = Math.sin(-t0.phi);
      const want = { phi: t.phi - t0.phi, x: c * dx - s * dy, y: s * dx + c * dy };
      const dPhi = Math.atan2(Math.sin(p.phi - s0.phi - want.phi), Math.cos(p.phi - s0.phi - want.phi));
      expect(Math.abs(dPhi), `${n} turn`).toBeLessThan(rad(1));
      // Within 2.5 cells (about 30 cm on the corn flight): the second pass hangs off the first through the turn
      // photograph alone, so a fraction of a degree there swings it; the soil ties refine the cameras afterwards.
      expect(Math.hypot(p.x - s0.x - want.x, p.y - s0.y - want.y), `${n} place`).toBeLessThan(2.5);
    }
  }, 120_000);

  it("writes headers that project through the camera model the way the placement says", () => {
    const size = { width: 5280, height: 3956 }, gsd = 0.005, cell = 24;
    for (const phiDeg of [0, 90, 180, -37]) {
      const pose: Pose = { phi: rad(phiDeg), x: 100, y: -40 };
      const meta = matchedMeta(pose, size, cell, gsd);
      const f = frameFromDji("p", meta, { ground: takeoffPlane(0) });
      if ("reason" in f) throw new Error(f.reason);
      const enu = (u: number, v: number) => { const g = pixelToGround(f.frame, u, v)!; return toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, { ...STAND_IN_ORIGIN, altM: 0 }); };
      // The centre lands where the pose puts it: x east, y south, in cells of `cell` original pixels.
      const c = enu(size.width / 2, size.height / 2);
      expect(c[0]).toBeCloseTo(100 * cell * gsd, 2);
      expect(c[1]).toBeCloseTo(40 * cell * gsd, 2);
      // A step of 1000 pixels up the photograph lands 1000 x gsd along R(phi)(0, -1) on the screen.
      const up = enu(size.width / 2, size.height / 2 - 1000);
      const want = [Math.sin(pose.phi) * 1000 * gsd, Math.cos(pose.phi) * 1000 * gsd];
      expect(up[0] - c[0]).toBeCloseTo(want[0], 2);
      expect(up[1] - c[1]).toBeCloseTo(want[1], 2);
      // And a step to the right along R(phi)(1, 0): east cos phi, north -sin phi.
      const right = enu(size.width / 2 + 1000, size.height / 2);
      expect(right[0] - c[0]).toBeCloseTo(Math.cos(pose.phi) * 1000 * gsd, 2);
      expect(right[1] - c[1]).toBeCloseTo(-Math.sin(pose.phi) * 1000 * gsd, 2);
    }
  });
});
