// Field Twin engine timings outside the browser: generate a synthetic field, build the intelligence and the scene,
// run every Explore Findings query. Phase timings in milliseconds.
//
//   npx vite-node scripts/directGeoref/twinEngineBench.ts -- [--sizes 100000,1000000]
import { FindingsEngine, type FindingMode } from "../../src/lib/fieldTwin/findings";
import { buildHeatLevels } from "../../src/lib/fieldTwin/heatmap";
import { fieldIntelligence } from "../../src/lib/fieldTwin/intelligence";
import { buildScene } from "../../src/lib/fieldTwin/scene";
import { syntheticTwin } from "../../src/lib/fieldTwin/synthetic";

const argv = process.argv.slice(2);
const sizes = (argv[argv.indexOf("--sizes") + 1] ?? "100000,1000000").split(",").map(Number);
const time = <T,>(fn: () => T): [T, number] => { const t = performance.now(); const v = fn(); return [v, Math.round(performance.now() - t)]; };
for (const n of sizes) {
  const out: Record<string, unknown> = { n };
  const [twin, tGen] = time(() => syntheticTwin({ weeds: n })); out.generateMs = tGen;
  const [intel, tIntel] = time(() => fieldIntelligence(twin)); out.intelligenceMs = tIntel; out.cells = intel.grid.cells.length; out.zones = intel.zones.length;
  const [, tScene] = time(() => buildScene(twin, intel)); out.sceneMs = tScene;
  const [, tHeat] = time(() => buildHeatLevels(intel)); out.heatmapMs = tHeat;
  const engine = new FindingsEngine(twin, intel);
  for (const mode of ["overview", "largest", "clusters", "pressure", "extent", "confidence", "rows"] as FindingMode[]) {
    const [r, t] = time(() => engine.run({ mode }));
    out[mode] = { ms: t, qualifying: r.findings.length, emphasized: r.prominence.count, rule: r.prominence.rule };
  }
  console.log(JSON.stringify(out));
}
