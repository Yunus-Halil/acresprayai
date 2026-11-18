// Named setups of the corn options (2026-11-18). A setup names what differs from the code's defaults, in the form the
// corn inspector's switches take (read: each photograph's read; field: plants first), and keeps beside it the full
// value of every option it resolved to on the day it was frozen (cornSetups.frozen.json), so a later change of a
// default shows up (src/test/cornSetups.test.ts) instead of quietly changing what the name means.
// Nothing in the app reads these: the build and Photo Scout run on the code's defaults.
import FROZEN from "./cornSetups.frozen.json";
import { CORN_CORES, CORN_COUNT_GUARD } from "../rowCrop/cornV1";
import { PLANTS_FIRST, ROW_RECALL, SEQUENCE } from "./plantsFirst";

export type CornSetup = { name: string; read: Record<string, unknown>; field: { sequence?: Partial<typeof SEQUENCE>; placing?: Partial<typeof PLANTS_FIRST>; free?: boolean; fieldSeed?: boolean; groundAsked?: boolean } };

/** The candidate frozen for FINAL-3.md: cores on (measured against the read's own marks), variant A of the spacing
 * option (placeOffSpacing for the stricter marks only), the emergence guard on with its misread check, the lone-mark
 * sweep off. Everything else as the code has it. */
export const CORN_CANDIDATE_FINAL3: CornSetup = {
  name: "Candidate frozen for FINAL-3",
  read: { cores: true, coresReference: "marks", countGuard: true },
  field: { sequence: { placeOffSpacing: true, offSpacingStricterOnly: true, sweepLoneMarks: false } },
};

/** Every option a setup resolves to with the code as it is: the switches (as the inspector lists them) and the full
 * option objects they live in. */
export function resolveSetup(s: CornSetup) {
  const cores = { ...CORN_CORES, on: (s.read.cores as boolean | undefined) ?? CORN_CORES.on, reference: (s.read.coresReference as typeof CORN_CORES.reference | undefined) ?? CORN_CORES.reference };
  const guard = { ...CORN_COUNT_GUARD, on: (s.read.countGuard as boolean | undefined) ?? CORN_COUNT_GUARD.on };
  return {
    read: { cores: cores.on, coresReference: cores.reference, countGuard: guard.on, rowSpans: (s.read.rowSpans as boolean | undefined) ?? true },
    field: { free: s.field.free ?? false, fieldSeed: s.field.fieldSeed ?? true, groundAsked: s.field.groundAsked ?? true },
    CORN_CORES: cores, CORN_COUNT_GUARD: guard,
    SEQUENCE: { ...SEQUENCE, ...(s.field.sequence ?? {}) }, PLANTS_FIRST: { ...PLANTS_FIRST, ...(s.field.placing ?? {}) }, ROW_RECALL: { ...ROW_RECALL, ...(s.field.free ? { anyView: true } : {}) },
  };
}

/** What CORN_CANDIDATE_FINAL3 resolved to when it was frozen. */
export const CORN_CANDIDATE_FINAL3_FROZEN = FROZEN as ReturnType<typeof resolveSetup>;
