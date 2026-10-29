// Per-scene diagnostics of the continuous-row reader on the rendered development stands.
import "../bench/nodeStorageShim";
import { renderScene, sceneSet } from "../cropProfiles/scenes";
import { readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const profile = cropProfileFor("corn")!;
const n = Number(process.argv[2] ?? 24);
for (const s of sceneSet("development").slice(0, n)) {
  const { px, truth } = renderScene(s);
  const dbg: string[] = [];
  const r = readRowCrop(px, rowCropParamsFor(profile, s.gsdM), { debug: l => dbg.push(l) });
  let on = 0, np = 0; for (const row of r.rows) for (const [x, y] of row.points) { np++; if (Math.abs(truth.acrossToRow(x * s.gsdM, -y * s.gsdM)) < s.pitchM / 4) on++; }
  const onRowWeeds = r.weeds.filter(w => Math.abs(truth.acrossToRow(w.x * s.gsdM, -w.y * s.gsdM)) < 0.1).length;
  let hit = 0; for (const t of truth.weeds) if (r.weeds.some(w => Math.hypot(w.x * s.gsdM - t.x, -w.y * s.gsdM - t.y) <= Math.max(0.08, t.r + 0.04))) hit++;
  console.log(`${s.name.padEnd(16)} gsd ${(s.gsdM * 100).toFixed(1)}cm ${s.widthM.toFixed(0)}x${s.heightM.toFixed(0)}m pitch ${(s.pitchM * 100).toFixed(0)} leaf ${s.leafM} ${s.soil}${s.straw ? "+straw" : ""}${s.twinM ? "+twin" : ""} ang ${s.angleDeg} | rows ${r.rows.length} pitch ${r.pitchM == null ? "-" : (r.pitchM * 100).toFixed(1)} dir ${r.directionDeg} onCrop ${np ? (on / np).toFixed(2) : "-"} band ${r.summary.medianBandHalfWidthM} weeds ${r.weeds.length} (onRow ${onRowWeeds}) truth ${truth.weeds.length} hit ${hit} inRow ${truth.inRowWeeds.length} | ${dbg[0] ?? ""}`);
}
