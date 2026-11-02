// The establishment field-edge step on the rendered development scenes: each scene read with the step on and off,
// the share of row points on the crop, rows, row length, and the field ends found (there are none to find: every
// rendered stand runs off the frame). Development only.
//   npx vite-node scripts/rowCrop/edgeScenesProbe.ts
import { renderScene, sceneSet } from "../cropProfiles/scenes";
import { EDGE, readRowCrop } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";

const profile = cropProfileFor("corn")!;
const saved = { ...EDGE };
for (const s of sceneSet("development").slice(0, 24)) {
  const { px, truth } = renderScene(s);
  const on = (x: number, y: number) => Math.abs(truth.acrossToRow(x * s.gsdM, -y * s.gsdM)) < s.pitchM / 4;
  const score = (read: ReturnType<typeof readRowCrop>) => { let a = 0, n = 0; for (const r of read.rows) for (const [x, y] of r.points) { n++; if (on(x, y)) a++; } return n ? (a / n).toFixed(2) : "-"; };
  Object.assign(EDGE, { minBandGreen: -1, bandShareOfTypical: 0, bandOverAlley: 0, bandOverAlleyBare: 0, greenGround: 9 });
  const off = readRowCrop(px, rowCropParamsFor(profile, s.gsdM));
  Object.assign(EDGE, saved);
  const onr = readRowCrop(px, rowCropParamsFor(profile, s.gsdM));
  console.log(`${s.name} leaf ${s.leafM} gsd ${s.gsdM} straw ${s.straw ? "y" : "n"} weeds ${s.weedsPerM2}/${s.weedRadiusM}: off rows ${off.rows.length} len ${off.summary.totalRowLengthM.toFixed(0)} on-crop ${score(off)} | on rows ${onr.rows.length} len ${onr.summary.totalRowLengthM.toFixed(0)} on-crop ${score(onr)} ends ${onr.fieldEdge?.ends.length ?? 0}`);
}
