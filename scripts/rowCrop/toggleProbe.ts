// Probe: one photograph read with a reader constant switched, to find which rule changed a read (read-only).
//   npx vite-node scripts/rowCrop/toggleProbe.ts -- --stage mid --photo 17 --set LATE.cornerRadius=9
import "../bench/nodeStorageShim";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../bench/images";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { EDGE, LATE, MID, readRowCrop, type RowCropStage } from "../../src/lib/rowCrop/readRowCrop";
import { EMERGENCE } from "../../src/lib/rowCrop/emergence";
import { FINE } from "../../src/lib/rowCrop/fineSeedlings";
import { rowCropParamsFor } from "../../src/lib/rowCrop/params";
import { cropProfileFor } from "../../src/lib/cropProfiles/registry";
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FOLDER: Record<string, string> = { emergence: "veryearlystage", establishment: "estabilishmentphase", mid: "midphase", late: "verylatestagecorn" };
const stage = arg("stage", "mid")!, photo = arg("photo", "17")!;
const raw = decodeImage(new Uint8Array(readFileSync(join("directtestimagery", FOLDER[stage], `${photo}.JPG`))));
const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
const groups: Record<string, Record<string, unknown>> = { EDGE, LATE, MID, EMERGENCE, FINE };
for (const s of (arg("set", "") ?? "").split(",").filter(Boolean)) { const [k, v] = s.split("="); const [g, f] = k.split("."); groups[g][f] = JSON.parse(v); }
const lines: string[] = [];
const read = readRowCrop(px, rowCropParamsFor(cropProfileFor("corn"), null, stage as RowCropStage), { debug: l => lines.push(l) });
console.log(`rows ${read.rows.length}, weeds ${read.summary.weeds}, length ${read.summary.totalRowLengthM} m | ${lines.filter(l => /^direction|^rows/.test(l)).map(l => l.slice(0, 160)).join(" | ")} | ${read.notes.slice(-2).join(" ").slice(0, 200)}`);
