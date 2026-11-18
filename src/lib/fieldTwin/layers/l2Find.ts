// L2 Find: a photograph's marks, from L1's views (2026-11-18).
//
//   in:   the photograph's pixels and its L1 views
//   out:  rowCrop/greenPoints.ts GreenPoints: the marks (photograph pixels), the first-pass marks from the green
//         first and the marks the vivid cores add after them (`coresAdded`), the typical plant's size, what the cores
//         pass kept (`coresInfo`), and per mark which views found it (`foundBy`: bit 1 the green, bit 2 a core)
//
// The first pass is the plant read's pieces of green (one mark a piece, a long piece cut along its length). The cores
// split a piece only where it holds more cores than marks: each mark takes its nearest core, and the cores left over
// become marks. The lower bar's candidates are made after the rows (rowCrop/cornV1.ts cornV1RowCandidates), not here.
import type { PhotoPixels } from "../../photoScout/pattern";
import { GREEN_POINTS, type GreenPoints, plantPointsFromGreen } from "../../rowCrop/greenPoints";
import type { PhotoViews } from "./l1Views";

export function findMarks(px: PhotoPixels, V: PhotoViews): GreenPoints {
  return plantPointsFromGreen(px, GREEN_POINTS, V.plant, V.cores?.asked ?? null, V.cores ? { strength: V.cores.strength, top: V.cores.top } : null);
}
