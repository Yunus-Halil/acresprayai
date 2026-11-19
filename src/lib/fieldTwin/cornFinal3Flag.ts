// Which corn preset (cornPreset.ts) the app reads with (SHIP-1, 2026-11-19):
//
//   everyone                    "final3": the frozen FINAL-3 preset with the cores gate (SPEED-1), the default since SHIP-1
//   VITE_CORN_FINAL3=0          "today": the corn results the app gave before SHIP-1 (origin/main e96fabb), for everyone,
//                               in any build: the kill switch. Set it in the deployment's environment and redeploy.
//
// Before SHIP-1 "final3" was the founder's alone, behind a switch on the build page and in Photo Scout (APP-1); the
// switch is gone. Nothing is sent anywhere and nothing on a server depends on this: it decides what this browser reads
// with. A build's worker reads it too (build/worker.ts), so a page and its worker cannot disagree.
import type { CornPreset } from "./cornPreset";

type Env = { VITE_CORN_FINAL3?: string };
const env = (): Env => { try { return (import.meta.env ?? {}) as Env; } catch { return {}; } };

/** The kill switch: the old corn path ("today") for everyone in this build. */
export const cornFinal3Killed = (e: Env = env()) => e.VITE_CORN_FINAL3 === "0";

/** The corn preset this build reads with. */
export function defaultCornPreset(e: Env = env()): CornPreset {
  return cornFinal3Killed(e) ? "today" : "final3";
}
