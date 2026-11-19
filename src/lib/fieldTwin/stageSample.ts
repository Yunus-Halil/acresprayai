// The check before a corn build looks at how late the flight is (2026-11-19): LATE_STAGE.sample photographs spread
// through the flight, each decoded reduced (checkDownFor) and assessed the way the corn read assesses a photograph
// (rowCrop/assess.ts), so the warning and the read's own late guard follow one signal (lateStage.ts). A warning
// only: the operator can always build.
import { assessField } from "../rowCrop/assess";
import { rowCropParamsFor } from "../rowCrop/params";
import { cropProfileFor } from "../cropProfiles/registry";
import type { PhotoPixels } from "../photoScout/pattern";
import { type FlightStage, checkDownFor, flightStageOf, lateShareOf, LATE_STAGE, spreadPick } from "./lateStage";

export type StageSample = FlightStage & { shares: { name: string; share: number | null }[]; down: number; ms: number };

/** A photograph to look at: its name and a decode at `down` (1 full size). */
export type StagePhoto = { name: string; decode: (down: number) => Promise<PhotoPixels> };

/**
 * The flight's stage from a sample of its photographs. `gsdM`: the flight's pixel size (the photograph check's median),
 * or null (then the reduction is the most allowed). A photograph that cannot be decoded is skipped, not guessed.
 */
export async function sampleFlightStage(photos: StagePhoto[], gsdM: number | null, onProgress?: (done: number, total: number) => void, o = LATE_STAGE): Promise<StageSample> {
  const t0 = Date.now(), pick = spreadPick(photos, o.sample), down = checkDownFor(gsdM, o);
  const params = rowCropParamsFor(cropProfileFor("corn")!, gsdM ? gsdM * down : null);
  const shares: StageSample["shares"] = [];
  onProgress?.(0, pick.length);
  for (const p of pick) {
    let share: number | null = null;
    try { share = lateShareOf(assessField(await p.decode(down), params)); } catch { share = null; }
    shares.push({ name: p.name, share });
    onProgress?.(shares.length, pick.length);
    // Let the page draw between photographs.
    await new Promise(r => setTimeout(r, 0));
  }
  return { ...flightStageOf(shares.map(s => s.share), o), shares, down, ms: Date.now() - t0 };
}

/** The warning's words: the stage, and the pixel size too when the flight is also coarse. */
export function lateFlightWarning(s: Pick<FlightStage, "looked" | "late">, gsdCm: number | null, maxGsdCm = 1.5): string {
  const high = gsdCm != null && gsdCm > maxGsdCm ? ` It was also flown high: about ${gsdCm.toFixed(1)} cm of ground per pixel, where reading corn needs about 1 cm.` : "";
  return `This looks like a late flight. In ${s.late} of the ${s.looked} photographs looked at, the corn canopy has closed, so Swardus can't see individual plants or the ground between the rows. Rows and weeds will be unreliable and plants will not be counted where the canopy has closed.${high} For now, use photographs from earlier in the season, before the leaves meet across the rows. Support for later flights is coming in an update.`;
}
