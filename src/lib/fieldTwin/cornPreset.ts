// The corn setup an app build or Photo Scout reads with (APP-1, 2026-11-18). Two, by name:
//
//   "today"   the corn results the app gives on origin/main (e96fabb, 2026-11-18): each photograph read without the
//             candidates' extents and without the lower bar's candidates, no vivid cores, no emergence guard; the
//             field's plants placed by the rules as they stood (SEQUENCE_V1, PLANTS_FIRST_V1) with the ground not
//             asked. Since SHIP-1 (2026-11-19) only behind the kill switch VITE_CORN_FINAL3=0 (cornFinal3Flag.ts).
//   "final3"  the app's corn behaviour for everyone since SHIP-1 (2026-11-19). The setup frozen for FINAL-3 (cornSetups.ts CORN_CANDIDATE_FINAL3, corn-benchmark FINAL-3.md): the code's
//             defaults (extents, lower-bar candidates, the ground, the rules as they are now) with the vivid cores on
//             (the gentler blurs, measured against the read's own marks), the spacing option for the stricter marks
//             only (variant A), the emergence guard with the flight's misread rule above 1.5 times the median row
//             spacing, and the final sweep of lone marks off. Since SPEED-1 the cores run only on a photograph whose
//             plants are big enough to touch (rowCrop/cornV1.ts CORES_WHEN_TOUCHING). The layers' options (layers/options.ts) all off: 2a
//             waits for the founder's look at cs19. Since 2026-11-19 also the "too far" dots tried again and the doubles
//             told apart from the green that is not corn (SEQUENCE.retryTooFar, doublesApart; the frozen setup itself unchanged).
//
// The settings are read here and passed down (a build's helper workers get the name and look it up); nothing sets a
// module-wide default, so a "today" read in one tab and a "final3" read in another cannot mix.
import { CORN_CANDIDATE_FINAL3 } from "./cornSetups";
import type { CornPlantsOptions } from "./layers/l3Place";
import { PLANTS_FIRST, PLANTS_FIRST_V1, SEQUENCE, SEQUENCE_V1 } from "./plantsFirst";

export type CornPreset = "today" | "final3";
export const CORN_PRESETS: readonly CornPreset[] = ["today", "final3"];

export type CornPresetSettings = {
  /** Each photograph's read (rowCrop/cornV1.ts readCornV1 options). */
  read: { rowSpans: boolean; rowCandidates: boolean; cores: boolean; coresReference: "marks" | "strongest"; countGuard: boolean; /** The late guard (lateStage.ts): a closed canopy withholds the count too. */ lateGuard: boolean; learnedGreen: boolean; /** SPEED-1: the cores only where the plants are big enough to touch (cornV1.ts CORES_WHEN_TOUCHING). */ coresWhenTouching: boolean };
  /** The compact read keeps what the plants look like (cornField.ts CornPhotoRead.look); "today" does not have it. */
  keepLook: boolean;
  /** The emergence guard over the flight (cornField.ts cornFlightGuard): a photograph that misread its row spacing gives no plants. */
  flightGuard: boolean;
  /** The field's planted / scattered judgement passed to plants first. */
  ground: boolean;
  /** Plants first's rules (cornPlants.ts), without the ground (added by the stage when `ground`). */
  plants: Omit<CornPlantsOptions, "ground">;
};

const F3 = CORN_CANDIDATE_FINAL3;
export const CORN_PRESET_SETTINGS: Record<CornPreset, CornPresetSettings> = {
  today: {
    read: { rowSpans: false, rowCandidates: false, cores: false, coresReference: "marks", countGuard: false, lateGuard: false, learnedGreen: false, coresWhenTouching: false },
    keepLook: false, flightGuard: false, ground: false,
    plants: { sequence: SEQUENCE_V1, placing: PLANTS_FIRST_V1 },
  },
  final3: {
    read: { rowSpans: true, rowCandidates: true, cores: F3.read.cores as boolean, coresReference: F3.read.coresReference as "marks", countGuard: F3.read.countGuard as boolean, lateGuard: true, learnedGreen: false, coresWhenTouching: true },
    keepLook: true, flightGuard: true, ground: true,
    // On top of the frozen FINAL-3 setup (2026-11-19, his word): the "too far" dots tried again once every other is
    // placed, and the doubles told apart from the green that is not corn (plantsFirst.ts SEQUENCE.retryTooFar, doublesApart).
    plants: { sequence: { ...SEQUENCE, ...F3.field.sequence, retryTooFar: true, doublesApart: true }, placing: PLANTS_FIRST, layers: {} },
  },
};

export const cornPresetSettings = (p: CornPreset | null | undefined): CornPresetSettings => CORN_PRESET_SETTINGS[p ?? "today"] ?? CORN_PRESET_SETTINGS.today;
