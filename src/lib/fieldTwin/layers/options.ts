// The layers' own options (2026-11-18), every one OFF by default: with all of them off every layer does exactly what
// it did before they existed. Each says which layer it changes; the corn inspector's Layers panel switches them.
//
//   groundFromObvious   L5 (phase 2a): the ground (planted / scattered) judged from L4's certain plants only, in place
//                       of every photograph's marks (cornField.ts plantedGround over the same squares and the same tests)
//   coresBySize         L1 (phase 3a): the cores' blurs as shares of the photograph's typical plant size, in place of
//                       its row spacing; a flight's sizes come from L5's profile (a second read), a single photograph's
//                       from its own first-pass marks
//   tooCloseFromSpread  L6 (phase 3b): the too-close limit from L5's spacing spread, in place of half a plant spacing
//   secondLook          L7 (phase 4): where L6 and L5 disagree, the spot read again in the photographs over it
//   unsureList          L8 (phase 4): the dots the views disagree on, listed with their photographs (recorded only)
//   learnedGreen        L1 (COLOUR-1, 2026-11-18): the green view learned per photograph (layers/l1Learned.ts): the
//                       corn and soil colours of the strict pass's sure plants and the soil away from them; L2 reads its
//                       mask in place of the fixed thresholds' (everything after L2 as before)
export const LAYERS = {
  groundFromObvious: false,
  coresBySize: false,
  /** coresBySize: the blurs' standard deviations as shares of the typical plant size (photo pixels). Anchored where
   * the row-spacing shares were tuned (53.JPG, TOUCH-3): 0.0566 and 0.2405 of its row spacing (212.1 px, the green
   * read's) over its typical plant (49.6 px, the median size of its 666 first-pass marks), measured 2026-11-18 before
   * any score: 12.0 and 51.0 px there either way. */
  coresSizeFine: 0.242, coresSizeWide: 1.0284,
  tooCloseFromSpread: false,
  /** tooCloseFromSpread: the limit is the lower fence of the single-spacing gaps between neighbouring certain plants,
   * Q1 - fence x (Q3 - Q1), held between `tooCloseMinShare` and `tooCloseMaxShare` of the plant spacing. */
  tooCloseFence: 1.5, tooCloseMinShare: 0.25, tooCloseMaxShare: 0.75,
  secondLook: false,
  /** secondLook: a refused dot is looked at again when this many photographs or more made it. */
  secondLookMinPhotos: 3,
  /** secondLook: a plant is added (or a refused dot put on its row) only where at least this many of the photographs
   * that look at the spot, and at least this share of them, show green there that is not a neighbour's. */
  secondLookMinShow: 2, secondLookShowShare: 0.5,
  unsureList: false,
  learnedGreen: false,
};
export type LayerOptions = typeof LAYERS;
