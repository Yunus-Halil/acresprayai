// L7 Second look (2026-11-18: NOT BUILT; it passes L6's reading through unchanged).
//
//   in:   L6's reading (plantsFirst.ts Reconstruction) and L5's profile
//   out:  the reading, with any plant a photograph shows where L6 and L5 disagree
//
// To come (the restructure brief, phase 4, an option off by default): only where L6 and L5 disagree (a gap longer than
// the profile's spacing spread allows; a dot L6 refused that 3 or more photographs saw), the spot read again in the
// photographs that cover it, with the view that fits the doubt. A plant is added only where a photograph shows one,
// never because the pattern expects one.
import type { Reconstruction } from "../plantsFirst";

export function secondLook(rec: Reconstruction): Reconstruction {
  return rec;
}
