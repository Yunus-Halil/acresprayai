// Who reads corn with the frozen FINAL-3 preset (cornPreset.ts "final3"), APP-1, 2026-11-18:
//
//   the founder's own account   only when the founder has switched it on, on this device (a switch shown to the
//                               founder alone, on the build page and in Photo Scout; off until then). Not while the
//                               founder previews the participant experience.
//   anyone else                 never: everyone else reads with "today", the corn results the app gave before it.
//   VITE_CORN_FINAL3=0          off for everyone, the founder too, in any build: the kill switch
//   VITE_CORN_FINAL3=1          on for everyone, but only in a development build (npm run dev); a deployed build ignores it
//
// Off, the app is as it was: every corn build and every Photo Scout corn read names "today". It decides what this
// browser reads with; nothing is sent anywhere and nothing on a server depends on it.
import { useSyncExternalStore } from "react";
import { type PilotRole, usePilotRole } from "@/lib/pilot/access";
import type { CornPreset } from "./cornPreset";

type Env = { DEV?: boolean; VITE_CORN_FINAL3?: string };
const env = (): Env => { try { return (import.meta.env ?? {}) as Env; } catch { return {}; } };

/** The founder's switch on this device (a per-device convenience; nothing else reads it). */
export const CORN_FINAL3_KEY = "swathwise:corn-final3";

export const cornFinal3Killed = (e: Env = env()) => e.VITE_CORN_FINAL3 === "0";
/** The developer's switch: on for everyone, in a development build only. */
export const cornFinal3DevFlag = (e: Env = env()) => !cornFinal3Killed(e) && !!e.DEV && e.VITE_CORN_FINAL3 === "1";

function readSwitch(): boolean { try { return typeof localStorage !== "undefined" && localStorage.getItem(CORN_FINAL3_KEY) === "1"; } catch { return false; } }
const listeners = new Set<() => void>();
export function setCornFinal3Switch(on: boolean): void {
  try { if (on) localStorage.setItem(CORN_FINAL3_KEY, "1"); else localStorage.removeItem(CORN_FINAL3_KEY); } catch { /* storage unavailable: stays off */ }
  for (const l of listeners) l();
}
export function useCornFinal3Switch(): boolean {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, readSwitch, () => false);
}

/** The preset an account shown as `role` reads corn with, given the founder's switch on this device. */
export function cornPresetFor(role: PilotRole | null, switchOn: boolean, e: Env = env()): CornPreset {
  if (cornFinal3Killed(e)) return "today";
  if (cornFinal3DevFlag(e)) return "final3";
  return role === "founder" && switchOn ? "final3" : "today";
}
/** Whether the switch is offered to an account shown as `role` (the founder only; never with the kill switch). */
export const cornFinal3Offered = (role: PilotRole | null, e: Env = env()) => !cornFinal3Killed(e) && role === "founder";

/** The signed-in account's corn preset, and whether it is offered the switch. */
export function useCornPreset(): { preset: CornPreset; offered: boolean; on: boolean } {
  const role = usePilotRole(), on = useCornFinal3Switch();
  return { preset: cornPresetFor(role, on), offered: cornFinal3Offered(role), on };
}
