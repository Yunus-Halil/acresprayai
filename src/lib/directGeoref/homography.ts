// The four-corner shortcut: once the photograph's corners are on the ground, every other pixel follows.
//
// For a pinhole camera over FLAT ground the mapping from pixels to ground is a plane-to-plane perspective map, a
// 3x3 homography, and four point pairs (the corners) fix it exactly. So "know the corners, know every pixel" is true,
// with two conditions: the interpolation must be projective (a homography), not bilinear (bilinear is only exact when
// the camera looks straight down), and the ground must be flat with no lens distortion left (otherwise the full ray
// cast in projection.ts is the reference). The tests measure both differences.
//
// The same matrix is what a browser needs to draw the photograph on the map: CSS matrix3d is a homography.

export type H3 = [number, number, number, number, number, number, number, number, number];
export type P2 = [number, number];

/** Solve the 8x8 system for H with h33 = 1 so that dst ~ H src. Null when the points are degenerate. */
export function homographyFrom4(src: P2[], dst: P2[]): H3 | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 9; j++) A[r][j] -= k * A[c][j];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyHomography(H: H3, x: number, y: number): P2 {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Bilinear interpolation between four corners (top-left, top-right, bottom-right, bottom-left) at fractions (s, t). */
export function bilinear(corners: P2[], s: number, t: number): P2 {
  const [a, b, c, d] = corners;
  const top: P2 = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const bot: P2 = [d[0] + (c[0] - d[0]) * s, d[1] + (c[1] - d[1]) * s];
  return [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t];
}
