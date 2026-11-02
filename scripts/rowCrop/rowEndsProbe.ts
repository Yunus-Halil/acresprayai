// Probe: each row's first and last drawn point and its gaps, for one photograph (read-only).
//   npx vite-node scripts/rowCrop/rowEndsProbe.ts -- --stage establishment --photo 34
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { readRowCrop, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const stage = arg("stage", "establishment")!, photo = arg("photo", "34")!;
const FOLDER: Record<string, string> = { emergence: "veryearlystage", establishment: "estabilishmentphase", mid: "midphase", late: "verylatestagecorn" };
const READER: Record<string, RowCropStage> = { emergence: "emergence", establishment: "establishment", mid: "mid", late: "late" };
const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery", FOLDER[stage], `${photo}.JPG`))));
const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, READER[stage]));
for (const r of read.rows) console.log(`row ${r.id} k ${r.k}: ${r.points[0].map(Math.round)} -> ${r.points[r.points.length - 1].map(Math.round)} (${r.points.length} pts) gaps ${r.gaps.map(g => `${Math.round(g.y1)}-${Math.round(g.y2)}`).join(" ")}`);
for (const e of read.fieldEdge?.ends ?? []) if (e.x > 4300 && e.x < 5000) console.log(`end row ${e.row} at ${Math.round(e.x)},${Math.round(e.y)} ${e.beyond}`);
