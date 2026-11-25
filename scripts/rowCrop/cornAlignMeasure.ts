// Development only, read only: how the photographs of a stored corn flight disagree on where the same plants are,
// measured PAIR BY PAIR (2026-11-25). The registration (plantsFirst.ts registerPhotos) reads each photograph against
// all the others at once; here every pair of overlapping photographs is read by itself, in squares of ground, so a
// disagreement between two flight lines cannot hide behind the agreement of a photograph with its own line.
//
// For each pair and square: the sharpest repeats of one photograph's marks in the other's (centimetre bins, as the
// registration votes), up to three, because plants a spacing apart along a row repeat too. Then the questions:
//   1. one shift for a whole flight line?   2. a shift of its own for every photograph?   3. worse at the frame's edges?
// answered by fitting each explanation to the same measurements and saying what it leaves over.
//
//   npx vite-node scripts/rowCrop/cornAlignMeasure.ts -- --analysis <analysis.json> --out <dir> [--preset final3] [--cell 4]
import "../bench/nodeStorageShim";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { framesFromAnalysis, type TwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { cornCombine } from "../../src/lib/fieldTwin/build/corn";
import { CORN_PRESET_SETTINGS } from "../../src/lib/fieldTwin/cornPreset";
import { shiftOf, type PhotoShift, type Sight } from "../../src/lib/fieldTwin/plantsFirst";
import { toEnu } from "../../src/lib/sourceFrames/odm";
import { type Meas, type ModelName, MODELS, fitModel, flightLines, measurePairs, residualsOf, summarise } from "./cornAlignLib";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) { if (d == null) throw new Error(`--${k} is required`); return d; } return argv[i + 1]; };
const A = JSON.parse(readFileSync(arg("analysis"), "utf8")) as TwinAnalysis, OUT = arg("out"), CELL = Number(arg("cell", "4"));
mkdirSync(OUT, { recursive: true });
const frames = framesFromAnalysis(A);
// --together [json]: the build's own step that aligns the photographs together turned on for this run (fieldTwin/alignTogether.ts).
if (argv.includes("--together")) { const v = argv[argv.indexOf("--together") + 1]; CORN_PRESET_SETTINGS.final3.plants = { ...CORN_PRESET_SETTINGS.final3.plants, together: v && v.startsWith("{") ? JSON.parse(v) : true }; }
const C = cornCombine(A.reads as never, frames, arg("preset", "final3") as "final3"), P = C.placed!, F = C.field;
const sights = P.sights as Sight[], photos = P.photos, nP = photos.length;
const dirDeg = F.directionDeg ?? 0, th = (dirDeg * Math.PI) / 180, ax: [number, number] = [Math.cos(th), Math.sin(th)];
const cam = photos.map(n => { const f = frames.get(n)!; const [e, nn] = toEnu({ lat: f.pose.lat, lng: f.pose.lng, altM: 0 }, F.origin); return { e, n: nn, h: f.pose.altM - (f.ground as { altM: number }).altM, W: f.intrinsics.width, H: f.intrinsics.height, cx: f.intrinsics.cx, cy: f.intrinsics.cy }; });
const lines = flightLines(cam);
const lineOf = new Int32Array(nP).fill(-1); lines.forEach((L, k) => { for (const p of L.photos) lineOf[p] = k; });

const none: PhotoShift[] = photos.map(() => ({ e: [0, 0, 0], n: [0, 0, 0], u0: 0, v0: 0, cells: 0 }));
const place = (shifts: PhotoShift[]) => { const xs = new Float64Array(sights.length), ys = new Float64Array(sights.length); sights.forEach((s, i) => { const [de, dn] = shiftOf(shifts[s.p], s.u, s.v); xs[i] = s.e + de; ys[i] = s.n + dn; }); return { xs, ys }; };

const lines_: string[] = [];
const say = (s = "") => { console.log(s); lines_.push(s); };
const cm = (m: number) => (m * 100).toFixed(1);

say(`# Flight-line disagreement, measured pair by pair`);
say();
say(`Flight: ${A.twinId ?? "?"}; ${nP} photographs with marks, ${sights.length} stricter marks; rows run at ${dirDeg.toFixed(1)} degrees (from east), row spacing ${(F.pitchM ?? NaN).toFixed(3)} m, plant spacing ${P.pre.seedM != null ? P.pre.seedM.toFixed(3) : "not measured"} m; merge gate ${cm(P.gateM ?? NaN)} cm; squares of ${CELL} m.`);
say(`Flight lines: ${lines.length} (${lines.map(L => L.photos.length).join(", ")} photographs), heading ${lines.map(L => L.headingDeg.toFixed(0)).join(", ")} degrees from east; ${nP - lines.reduce((t, L) => t + L.photos.length, 0)} photographs on no line (turns). Photographs ${lines[0] ? lines[0].stepM.toFixed(1) : "?"} m apart along a line, lines ${lines.length > 1 ? lines.slice(1).map((L, k) => L.offsetM(lines[k]).toFixed(1)).join(", ") : "?"} m apart.`);
say();

const states: { name: string; shifts: PhotoShift[] }[] = [{ name: "as the cameras place them (before the registration)", shifts: none }, { name: P.together?.applied ? "as the build has them (after the registration AND aligned together)" : "as the build has them (after the registration)", shifts: P.shifts }];
const out: Record<string, unknown> = { flight: A.twinId, photographs: nP, marks: sights.length, directionDeg: dirDeg, gateM: P.gateM, lines: lines.map(L => ({ photos: L.photos.map(p => photos[p]), headingDeg: L.headingDeg })) };
let regMeas: Meas[] = [];
for (const st of states) {
  const { xs, ys } = place(st.shifts);
  const M = measurePairs(sights, xs, ys, nP, cam, { cellM: CELL, axis: ax, seedM: P.pre.seedM ?? 0.14 });
  if (st.shifts === P.shifts) regMeas = M;
  say(`## ${st.name}`);
  say();
  const kind = (m: Meas) => (lineOf[m.i] < 0 || lineOf[m.j] < 0 ? "turn" : lineOf[m.i] === lineOf[m.j] ? "same" : Math.abs(lineOf[m.i] - lineOf[m.j]) === 1 ? "next" : "far");
  const table = (rows: [string, Meas[]][]) => {
    say(`| Pairs of photographs | Squares measured | Median disagreement, cm | 90th percentile, cm | Across the rows: median size, cm | Along the rows: median size, cm | Squares over the merge gate | Squares where a plant spacing along the row is as good a repeat |`);
    say(`|---|---:|---:|---:|---:|---:|---:|---:|`);
    for (const [name, ms] of rows) { const S = summarise(ms, ms.map(m => m.c[0]), ax, P.gateM ?? 0.06); say(`| ${name} | ${ms.length} | ${cm(S.median)} | ${cm(S.p90)} | ${cm(S.acrossMedian)} | ${cm(S.alongMedian)} | ${S.over} (${((100 * S.over) / Math.max(1, ms.length)).toFixed(0)} %) | ${ms.filter(m => m.ambiguous).length} (${((100 * ms.filter(m => m.ambiguous).length) / Math.max(1, ms.length)).toFixed(0)} %) |`); }
    say();
  };
  table([["all", M], ["on the same flight line", M.filter(m => kind(m) === "same")], ["on neighbouring flight lines", M.filter(m => kind(m) === "next")], ["two or more lines apart", M.filter(m => kind(m) === "far")], ["with a photograph of a turn", M.filter(m => kind(m) === "turn")]]);
  out[st.shifts === none ? "before" : "after"] = { all: summarise(M, M.map(m => m.c[0]), ax, P.gateM ?? 0.06), same: summarise(M.filter(m => kind(m) === "same"), M.filter(m => kind(m) === "same").map(m => m.c[0]), ax, P.gateM ?? 0.06), next: summarise(M.filter(m => kind(m) === "next"), M.filter(m => kind(m) === "next").map(m => m.c[0]), ax, P.gateM ?? 0.06) };

  // Question 3, read directly: the disagreement by how far out in the two frames the square lies.
  say(`By where the square lies in the two frames (0 = the middle, 1 = the corner; the further of the two photographs):`);
  say();
  say(`| Furthest from the middle | Same line: squares | median, cm | Neighbouring lines: squares | median, cm |`);
  say(`|---|---:|---:|---:|---:|`);
  for (let b = 0; b < 5; b++) { const inB = (m: Meas) => { const r = Math.max(m.ri, m.rj); return r >= b * 0.2 && r < (b + 1) * 0.2 + (b === 4 ? 1 : 0); }; const s = M.filter(m => kind(m) === "same" && inB(m)), n = M.filter(m => kind(m) === "next" && inB(m)); const med = (ms: Meas[]) => (ms.length ? cm(summarise(ms, ms.map(m => m.c[0]), ax, 1).median) : "-"); say(`| ${(b * 0.2).toFixed(1)} to ${((b + 1) * 0.2).toFixed(1)} | ${s.length} | ${med(s)} | ${n.length} | ${med(n)} |`); }
  say();

  // Question 1, read directly: per pair of neighbouring lines, the mean offset and how it varies from photograph pair to photograph pair.
  say(`Per pair of neighbouring flight lines (offset of the second line's photographs from the first's, in the squares both see):`);
  say();
  say(`| Lines | Squares | Mean across the rows, cm | Mean along the rows, cm | Spread of the photograph pairs' own means: across, cm | along, cm | Spread inside a photograph pair (square to square): across, cm | along, cm |`);
  say(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (let k = 0; k + 1 < lines.length; k++) {
    const ms = M.filter(m => (lineOf[m.i] === k && lineOf[m.j] === k + 1) || (lineOf[m.i] === k + 1 && lineOf[m.j] === k));
    if (!ms.length) continue;
    const signed = ms.map(m => { const s = lineOf[m.i] === k ? 1 : -1, d = m.c[0]; return { key: m.i * 1000 + m.j, a: s * (d.x * ax[0] + d.y * ax[1]), c: s * (-d.x * ax[1] + d.y * ax[0]) }; });
    const mean = (v: number[]) => v.reduce((t, x) => t + x, 0) / Math.max(1, v.length), sd = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map(x => (x - m) ** 2))); };
    const byPair = new Map<number, { a: number[]; c: number[] }>(); for (const s of signed) { const g = byPair.get(s.key) ?? byPair.set(s.key, { a: [], c: [] }).get(s.key)!; g.a.push(s.a); g.c.push(s.c); }
    const pm = [...byPair.values()].filter(g => g.a.length >= 3);
    say(`| ${k + 1} and ${k + 2} | ${ms.length} | ${cm(mean(signed.map(s => s.c)))} | ${cm(mean(signed.map(s => s.a)))} | ${cm(sd(pm.map(g => mean(g.c))))} | ${cm(sd(pm.map(g => mean(g.a))))} | ${cm(mean(pm.map(g => sd(g.c))))} | ${cm(mean(pm.map(g => sd(g.a))))} |`);
  }
  say();
}

// The explanations, each fitted to the registered state's measurements: what would be left if the photographs were moved that way.
say(`## What each explanation leaves over (fitted to the measurements after the registration)`);
say();
say(`Every row is a correction fitted to ALL pairs at once (least squares, large misfits weighed down, the repeat chosen again after each fit among a square's up to three). "Left over" is the disagreement that correction would leave.`);
say();
say(`| Correction fitted | Unknowns | All squares: median left over, cm | 90th percentile, cm | Over the merge gate | Neighbouring lines: median, cm | 90th percentile, cm | Over the merge gate | Same line: median, cm | Over the merge gate | CHECK on pairs of photographs the fit never saw (a third of the pairs held back, fitted on the rest): median, cm | 90th percentile, cm | over the merge gate |`);
say(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
// Held back: whole pairs of photographs, by a fixed rule on their two numbers.
const heldBack = (m: Meas) => (m.i * 7 + m.j * 13) % 3 === 0, train = regMeas.filter(m => !heldBack(m)), test = regMeas.filter(heldBack);
const fits: Record<string, unknown> = {};
const kindR = (m: Meas) => (lineOf[m.i] < 0 || lineOf[m.j] < 0 ? "turn" : lineOf[m.i] === lineOf[m.j] ? "same" : Math.abs(lineOf[m.i] - lineOf[m.j]) === 1 ? "next" : "far");
for (const name of Object.keys(MODELS) as ModelName[]) {
  const t0 = Date.now(), fit = fitModel(name, regMeas, nP, cam, lineOf, lines.length, sights, CELL), R = residualsOf(regMeas, fit);
  const sub = (k: string | null) => { const idx = regMeas.map((m, q) => q).filter(q => k == null || kindR(regMeas[q]) === k); return summarise(idx.map(q => regMeas[q]), idx.map(q => R[q]), ax, P.gateM ?? 0.06); };
  const a = sub(null), nx = sub("next"), sm = sub("same");
  const fitT = fitModel(name, train, nP, cam, lineOf, lines.length, sights, CELL), held = summarise(test, residualsOf(test, fitT), ax, P.gateM ?? 0.06);
  say(`| ${MODELS[name]} | ${fit.unknowns} | ${cm(a.median)} | ${cm(a.p90)} | ${a.over} (${((100 * a.over) / regMeas.length).toFixed(0)} %) | ${cm(nx.median)} | ${cm(nx.p90)} | ${nx.over} (${((100 * nx.over) / Math.max(1, nx.n)).toFixed(0)} %) | ${cm(sm.median)} | ${sm.over} (${((100 * sm.over) / Math.max(1, sm.n)).toFixed(0)} %) | ${cm(held.median)} | ${cm(held.p90)} | ${held.over} of ${held.n} (${((100 * held.over) / Math.max(1, held.n)).toFixed(1)} %) |`);
  fits[name] = { unknowns: fit.unknowns, all: a, next: nx, same: sm, heldBack: held, ms: Date.now() - t0, extra: fit.extra };
  if (name === "photoShift") {
    // Question 2, read directly: each photograph's own fitted shift, line by line.
    const perLine = lines.map((L, k) => ({ line: k + 1, photos: L.photos.map(p => ({ name: photos[p].slice(-6), across: -fit.shiftAt(p, cam[p].cx, cam[p].cy)[0] * ax[1] + fit.shiftAt(p, cam[p].cx, cam[p].cy)[1] * ax[0], along: fit.shiftAt(p, cam[p].cx, cam[p].cy)[0] * ax[0] + fit.shiftAt(p, cam[p].cx, cam[p].cy)[1] * ax[1] })) }));
    fits.photoShiftPerLine = perLine;
  }
}
say();
out.fits = fits;
writeFileSync(join(OUT, "measure.json"), JSON.stringify(out, null, 1));
writeFileSync(join(OUT, "MEASURE-tables.md"), lines_.join("\n") + "\n");
writeFileSync(join(OUT, "pairs-after.json"), JSON.stringify(regMeas.map(m => ({ i: photos[m.i].slice(-6), j: photos[m.j].slice(-6), li: lineOf[m.i], lj: lineOf[m.j], x: +m.x.toFixed(2), y: +m.y.toFixed(2), ri: +m.ri.toFixed(2), rj: +m.rj.toFixed(2), d: m.c.map(c => [+(c.x * 100).toFixed(1), +(c.y * 100).toFixed(1), Math.round(c.w)]), n: m.votes }))));
