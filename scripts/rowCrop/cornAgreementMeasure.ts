// The photographs' agreement with one another over a flight's dots (APP-1, 2026-11-18): the measure, shared by
// cornAgreement.ts and cornScoreboard.ts. Read only; see cornAgreement.ts for what each number is.
import type { PlacedDots } from "../../src/lib/fieldTwin/layers/l3Place";
import type { Reconstruction } from "../../src/lib/fieldTwin/plantsFirst";

/** The agreement of the photographs over a flight's dots and rows (read only). */
export function photoAgreement(P: PlacedDots, rec: Reconstruction | null) {
  const S = P.sights ?? [];
  let inShared = 0;
  for (let i = 0; i < P.strict; i++) if (P.all[i].photos >= 2) inShared += P.all[i].members.length;
  const ratios: number[] = []; let all = 0, half = 0, one = 0;
  if (rec) for (let i = 0; i < P.all.length; i++) {
    if (rec.rowOf[i] < 0) continue;
    const c = P.covered[i], k = P.all[i].photos, r = c > 0 ? Math.min(1, k / c) : 0;
    ratios.push(r); if (k >= c && c > 0) all++; if (r >= 0.5) half++; if (k <= 1) one++;
  }
  ratios.sort((a, b) => a - b);
  const q = (t: number) => (ratios.length ? Math.round(ratios[Math.min(ratios.length - 1, Math.floor(t * ratios.length))] * 1000) / 1000 : null);
  const n = ratios.length, pc = (x: number) => (n ? Math.round((1000 * x) / n) / 10 : null);
  return {
    marks: { total: S.length, inADotAnotherPhotographMarked: inShared, sharePercent: S.length ? Math.round((1000 * inShared) / S.length) / 10 : null },
    onRows: { plants: n, ratio: { q1: q(0.25), median: q(0.5), q3: q(0.75), mean: n ? Math.round((1000 * ratios.reduce((a, b) => a + b, 0)) / n) / 1000 : null }, byEveryPhotographOverItPercent: pc(all), byHalfOrMorePercent: pc(half), byOnePhotographPercent: pc(one) },
    photographs: { withMarks: new Set(S.map(s => s.p)).size, inTheDots: P.photos.length },
  };
}
