// L1 Views: what a photograph is looked at through, computed once and shared by everything after it (2026-11-18).
//
//   in:   the photograph's pixels, its green read (rowCrop/adaptive.ts: plans and the row spacing it holds), the
//         photograph's seedling cache (the green judged against the soil beside it, made once in readCornV1), and
//         whether the vivid cores are asked (rowCrop/cornV1.ts CORN_CORES) and against what
//   out:  `green`  the seedling cache the green read used (rowCrop/seedlingGreen.ts)
//         `plant`  the mask the plant read uses (the same, or corn-v1.0's on a photograph read as bands or a canopy:
//                  rowCrop/cornV1.ts cornV1PlantCache)
//         `cores`  the cores view (rowCrop/greenCores.ts): its blurs from the row spacing (CORN_CORES), its strength
//                  image and highest value; null when the cores are not asked or the read holds no row spacing
import type { PhotoPixels } from "../../photoScout/pattern";
import type { AdaptiveRead } from "../../rowCrop/adaptive";
import { CORN_CORES, cornV1CoresAsked, cornV1PlantCache } from "../../rowCrop/cornV1";
import { coresView, vividGreen } from "../../rowCrop/greenCores";
import type { CoresAsked } from "../../rowCrop/greenPoints";
import { type SeedlingCache, sharedSeedlingMask } from "../../rowCrop/seedlingGreen";

export type PhotoViews = { green: SeedlingCache; plant: SeedlingCache; cores: { asked: CoresAsked; strength: Float32Array; top: number } | null };

export function photoViews(px: PhotoPixels, ad: AdaptiveRead, seedlings: SeedlingCache, cores: boolean = CORN_CORES.on, reference: "strongest" | "marks" = CORN_CORES.reference): PhotoViews {
  const plant = cornV1PlantCache(px, ad, seedlings), asked = cores ? cornV1CoresAsked(ad, reference) : null;
  const view = asked ? coresView(vividGreen(px), px.width, px.height, asked.finePx, asked.widePx) : null;
  return { green: seedlings, plant, cores: asked && view ? { asked, strength: view.strength, top: view.top } : null };
}

/** The green view: the plant read's mask (1 green), at the photograph's pixels. */
export const greenView = (V: PhotoViews, px: PhotoPixels) => sharedSeedlingMask(V.plant, px);
