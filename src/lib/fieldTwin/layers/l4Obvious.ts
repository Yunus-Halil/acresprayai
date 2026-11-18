// L4 Obvious: the certain plants (2026-11-18, moved out of plantsFirst.ts reconstruct, unchanged).
//
//   in:   the field's dots (L3), how many photographs looked at each (L3's coverage), the sequence's certainty
//         options (SEQUENCE.certainViews, certainShare), and the dots never to be certain (the candidates of the
//         lower bar: `notCertain`)
//   out:  per dot, its certainty as L4 says it (0 certain, 2 not), and the certain dots' indices
//
// A dot is certain on its own evidence (plantsFirst.ts certainEvidence): enough photographs made it, and enough of
// those that looked at its ground. Nothing later changes L4's own result: L6 works on a copy.
import { type Dot, SEQUENCE, certainEvidence } from "../plantsFirst";

export type ObviousPlants = { certainty: Uint8Array; certainIdx: number[] };

export function obviousPlants(dots: Dot[], covered: Int32Array, q: typeof SEQUENCE = SEQUENCE, notCertain: Uint8Array | null = null): ObviousPlants {
  const n = dots.length, certainty = new Uint8Array(n).fill(2);
  for (let i = 0; i < n; i++) if (!notCertain?.[i] && certainEvidence(dots[i], covered[i], q)) certainty[i] = 0;
  const certainIdx: number[] = []; for (let i = 0; i < n; i++) if (certainty[i] === 0) certainIdx.push(i);
  return { certainty, certainIdx };
}
