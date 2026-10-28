// Phase correlation for soil-texture ties: radix-2 FFT, 2D, and the shift between two equal-size windows.
//
// A window's spectrum (mean removed, Hann-tapered, transformed) is computed once and correlated against as many
// other windows as needed: the tie search correlates window A against B and then against B again at the found
// shift, and reuses A across the pairs the same photograph begins. The arithmetic of `phaseCorrelate` is
// unchanged by the split (the same operations in the same order), so ties are bit-identical to the one-shot form.

/** In-place iterative radix-2 FFT. `inverse` without the 1/n scale. n must be a power of two. */
export function fft1(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const rowScratch = new Map<number, [Float64Array, Float64Array]>();
const rowsOf = (n: number): [Float64Array, Float64Array] => { let s = rowScratch.get(n); if (!s) { s = [new Float64Array(n), new Float64Array(n)]; rowScratch.set(n, s); } return s; };

/** 2D FFT of an n x n grid, row-major, in place. */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false): void {
  const [r, i] = rowsOf(n);
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n)); i.set(im.subarray(y * n, y * n + n));
    fft1(r, i, inverse);
    re.set(r, y * n); im.set(i, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { r[y] = re[y * n + x]; i[y] = im[y * n + x]; }
    fft1(r, i, inverse);
    for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = i[y]; }
  }
}

export type PhaseShift = {
  /** Where window a's content sits in window b, in cells: b(x + dx, y + dy) ~ a(x, y). */
  dx: number;
  dy: number;
  /** Height of the correlation peak (1 = identical up to a shift). */
  peak: number;
  /** Highest value outside the peak's 5 x 5 neighbourhood, over the peak (lower is a clearer match). */
  secondRatio: number;
};

const hann = new Map<number, Float64Array>();
function hannOf(n: number): Float64Array {
  let w = hann.get(n);
  if (!w) {
    w = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) w[y * n + x] = (0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / n)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / n));
    hann.set(n, w);
  }
  return w;
}

/** A window's transform: mean removed, Hann-tapered, 2D FFT. Immutable once made; correlate never writes into it. */
export type Spectrum = { re: Float64Array; im: Float64Array; n: number };

export function spectrum(a: Float32Array | Float64Array, n: number): Spectrum {
  const w = hannOf(n);
  let m = 0;
  for (let k = 0; k < n * n; k++) m += a[k];
  m /= n * n;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) re[k] = (a[k] - m) * w[k];
  fft2(re, im, n);
  return { re, im, n };
}

const corrScratch = new Map<number, [Float64Array, Float64Array]>();

/** The shift of a within b from their spectra: the normalised cross-power spectrum inverted, with a parabolic sub-cell peak. */
export function correlate(A: Spectrum, B: Spectrum): PhaseShift {
  const n = A.n;
  let s = corrScratch.get(n);
  if (!s) { s = [new Float64Array(n * n), new Float64Array(n * n)]; corrScratch.set(n, s); }
  const [ar, ai] = s;
  const Ar = A.re, Ai = A.im, br = B.re, bi = B.im;
  // Cross-power spectrum B . conj(A), normalised: its inverse peaks at the displacement of a within b.
  for (let k = 0; k < n * n; k++) {
    const r = br[k] * Ar[k] + bi[k] * Ai[k], i = bi[k] * Ar[k] - br[k] * Ai[k];
    const m = Math.hypot(r, i) + 1e-12;
    ar[k] = r / m; ai[k] = i / m;
  }
  fft2(ar, ai, n, true);
  let best = -Infinity, bx = 0, by = 0;
  for (let k = 0; k < n * n; k++) { const v = ar[k] / (n * n); ar[k] = v; if (v > best) { best = v; bx = k % n; by = (k - bx) / n; } }
  let second = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ddx = Math.min(Math.abs(x - bx), n - Math.abs(x - bx)), ddy = Math.min(Math.abs(y - by), n - Math.abs(y - by));
    if (ddx <= 2 && ddy <= 2) continue;
    if (ar[y * n + x] > second) second = ar[y * n + x];
  }
  const at = (x: number, y: number) => ar[((y + n) % n) * n + ((x + n) % n)];
  const sub = (m: number, c: number, p: number) => { const d = m - 2 * c + p; return d === 0 ? 0 : (0.5 * (m - p)) / d; };
  let dx = bx + sub(at(bx - 1, by), best, at(bx + 1, by)), dy = by + sub(at(bx, by - 1), best, at(bx, by + 1));
  if (dx > n / 2) dx -= n;
  if (dy > n / 2) dy -= n;
  return { dx, dy, peak: best, secondRatio: best > 0 ? second / best : 1 };
}

/** Phase correlation of two n x n windows (mean removed, Hann-tapered), with a parabolic sub-cell peak. */
export function phaseCorrelate(a: Float32Array | Float64Array, b: Float32Array | Float64Array, n: number): PhaseShift {
  return correlate(spectrum(a, n), spectrum(b, n));
}
