// Development only: the plants the row-guided reading located (scripts/rowCrop/rowGuidedBench.ts, field.json) written
// beside a twin on this computer as plants.json, latitude and longitude, for the dev preview's row editor to draw and
// snap to. Nothing here is part of a build or uploaded; the twin itself is not touched.
//   npx vite-node scripts/rowCrop/exportPlantMarks.ts -- --analysis <twin>/analysis.json --field <bench>/field.json --out <twin>/plants.json
import { readFileSync, writeFileSync } from "node:fs";
import { framesFromAnalysis, parseTwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { type CornPhotoRead, cornField } from "../../src/lib/fieldTwin/cornField";
import { fromEnu } from "../../src/lib/sourceFrames/odm";
import { pixelToGround } from "../../src/lib/directGeoref/projection";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return argv[i + 1]; };
const parsed = parseTwinAnalysis(JSON.parse(readFileSync(arg("analysis"), "utf8")));
if (!parsed.ok) throw new Error("analysis record not readable");
const frames = framesFromAnalysis(parsed.analysis);
// The bench's marks are metres east and north of the first pass's origin: the same first pass gives the same origin.
const origin = cornField((parsed.analysis.reads as unknown as CornPhotoRead[]).filter(r => frames.has(r.name)), frames).origin;
const field = JSON.parse(readFileSync(arg("field"), "utf8")) as { marks: [number, number][]; markViews?: [string, number, number][][] };
// Each plant where the photographs that saw it put it, each through its own camera, averaged: the way the twin's rows
// and the photographs under it are placed. The reading's own position is pinned to its row lattice (each photograph
// is slid onto the lattice to find the plants), so where the lattice sits a few centimetres off the rows the twin
// draws, every plant there would sit off with it (seen on the Levi twin, 2026-11-13).
let fromViews = 0;
const points = field.marks.map(([e, n], k) => {
  const seen = (field.markViews?.[k] ?? []).map(([photo, u, v]) => { const f = frames.get(photo); return f ? pixelToGround(f, u, v) : null; }).filter((g): g is NonNullable<typeof g> => !!g);
  let lat: number, lng: number;
  if (seen.length) { lat = seen.reduce((t, g) => t + g.lat, 0) / seen.length; lng = seen.reduce((t, g) => t + g.lng, 0) / seen.length; fromViews++; }
  else { const ll = fromEnu([e, n, 0], origin); lat = ll.lat; lng = ll.lng; }
  return [Math.round(lat * 1e8) / 1e8, Math.round(lng * 1e8) / 1e8];
});
writeFileSync(arg("out"), JSON.stringify({ version: 1, source: "row-guided reading (development)", note: "Plants the photographs located along the rows. Not identified as corn by their look; development output, not a count.", points }));
console.log(`${points.length} plants (${fromViews} placed by the photographs that saw them) -> ${arg("out")}`);
