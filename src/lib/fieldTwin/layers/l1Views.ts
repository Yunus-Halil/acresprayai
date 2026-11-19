// L1 Views: what a photograph is looked at through, computed once and shared by everything after it (2026-11-18).
//
//   in:   the photograph's pixels; its seedling cache (the green judged against the soil beside it, made once in
//         rowCrop/cornV1.ts readCornV1); the mask the plant read uses (the same cache, or corn-v1.0's on a photograph
//         read as bands or a canopy: cornV1.ts cornV1PlantCache); the photograph's row spacing in its own pixels (the
//         green read's: cornV1.ts greenPitchPx, null where it holds none); and whether the vivid cores are asked
//         (CORN_CORES, below) and against what
//   out:  `green`  the seedling cache the green read used (rowCrop/seedlingGreen.ts)
//         `plant`  the mask the plant read uses
//         `cores`  the cores view (rowCrop/greenCores.ts): its blurs from the row spacing (CORN_CORES), its strength
//                  image and highest value; null when the cores are not asked or the read holds no row spacing
//
// L1 imports nothing from the reader (cornV1.ts): the reader hands it what it made (2026-11-18 clean-up, no import cycle).
import type { PhotoPixels } from "../../photoScout/pattern";
import { coresView, vividGreen } from "../../rowCrop/greenCores";
import type { CoresAsked } from "../../rowCrop/greenPoints";
import { type SeedlingCache, sharedSeedlingMask } from "../../rowCrop/seedlingGreen";
import { LAYERS } from "./options";

/**
 * The vivid cores (greenCores.ts, greenPoints.ts plantPointsFromGreen), 2026-11-17: OFF. Where plants touch and one
 * piece of green holds several, the plant read marks one of them; with this on, a piece that shows more vivid cores
 * than it has marks gets the cores left over as marks too. It changes the marks a photograph makes, so a build and
 * Photo Scout both read with it when it is on (both go through readCornV1). The corn-v1.0 comparison read never uses it.
 * Measured on one hand-labelled photograph only (corn-benchmark TOUCH-3.md). (Moved here from cornV1.ts, which
 * re-exports it, 2026-11-18.)
 */
export const CORN_CORES = {
  on: false,
  /** The two blurs' standard deviations, as shares of the photograph's row spacing in pixels (greenPitchPx: the green
   * read's). With no row spacing the photograph gets no cores. The gentler pair (2026-11-18): the first, 0.0377 and
   * 0.1603, found two more plants of 403 on the labelled photograph and made 16 wrong marks where this makes 4. */
  fineShare: 0.0566, wideShare: 0.2405,
  /** What a core is measured against (greenPoints.ts CoresAsked, 2026-11-18):
   *   "marks"      a peak at or over `factor` times the median strength of the cores on the read's own marks in the photograph;
   *   "strongest"  a peak at or over `share` of the photograph's strongest core (the first way, kept runnable: a grass
   *                verge in the frame makes that core so strong that no crop core passes). */
  reference: "marks" as "strongest" | "marks",
  factor: 0.4,
  share: 0.15,
};

/** The vivid cores as asked of a photograph: the blurs from its row spacing in pixels; null with none. With `sizePx`
 * (LAYERS.coresBySize, phase 3a, off by default) the blurs are shares of the typical plant's size instead
 * (LAYERS.coresSizeFine, coresSizeWide), and a photograph with a size but no row spacing gets cores too. */
export function coresAsked(pitchPx: number | null, reference: "strongest" | "marks" = CORN_CORES.reference, sizePx: number | null = null): CoresAsked | null {
  // CORES-2 (LAYERS.coresStartOnNoGreen): asked only when on, so a read with it off carries exactly what it did.
  const start = LAYERS.coresStartOnNoGreen != null ? { startOnNoGreen: LAYERS.coresStartOnNoGreen } : {};
  if (sizePx != null && sizePx > 0 && Number.isFinite(LAYERS.coresSizeFine) && Number.isFinite(LAYERS.coresSizeWide)) return { finePx: LAYERS.coresSizeFine * sizePx, widePx: LAYERS.coresSizeWide * sizePx, share: CORN_CORES.share, reference, factor: CORN_CORES.factor, ...start };
  return pitchPx && pitchPx > 0 ? { finePx: CORN_CORES.fineShare * pitchPx, widePx: CORN_CORES.wideShare * pitchPx, share: CORN_CORES.share, reference, factor: CORN_CORES.factor, ...start } : null;
}

export type PhotoViews = { green: SeedlingCache; plant: SeedlingCache; cores: { asked: CoresAsked; strength: Float32Array; top: number } | null };
/** What the reader made of the photograph that L1 needs: the seedling cache, the plant read's mask, the row spacing. */
export type ViewInputs = { seedlings: SeedlingCache; plant: SeedlingCache; pitchPx: number | null; /** Phase 3a: the typical plant's size, photo pixels. */ sizePx?: number | null };

export function photoViews(px: PhotoPixels, inp: ViewInputs, cores: boolean = CORN_CORES.on, reference: "strongest" | "marks" = CORN_CORES.reference): PhotoViews {
  const asked = cores ? coresAsked(inp.pitchPx, reference, inp.sizePx ?? null) : null;
  const view = asked ? coresView(vividGreen(px), px.width, px.height, asked.finePx, asked.widePx) : null;
  return { green: inp.seedlings, plant: inp.plant, cores: asked && view ? { asked, strength: view.strength, top: view.top } : null };
}

/** The green view: the plant read's mask (1 green), at the photograph's pixels. */
export const greenView = (V: PhotoViews, px: PhotoPixels) => sharedSeedlingMask(V.plant, px);
