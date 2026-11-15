// Who sees photo ground (photoGround.ts): the flight's photographs laid under the twin.
//
//   the founder's own account   yes, in every deployment (the role the database states, pilot_members; not while the
//                               founder previews the participant experience, which shows what participants see)
//   anyone else                 no. No deployment setting turns it on for participants: that is a code change, made
//                               only with the participant terms saying what it keeps
//   VITE_FIELD_TWIN_PHOTO_GROUND=1   on for everyone, but only in a development build (npm run dev, the dev preview);
//                               a deployed build ignores it
//   VITE_FIELD_TWIN_PHOTO_GROUND=0   off for everyone, the founder too, in any build: the kill switch
//
// Off, nothing about a build or the viewer changes: no stage runs, no tile is made, no control is shown, and the twin
// is the same file. On, the overview is made after the twin and its evidence crops are complete and is KEPT IN THIS
// BROWSER ONLY (never uploaded: retaining growers' photographs needs the participant terms to say so); detail and the
// photographs behind a finding come from the flight's own files on this device, on demand.
//
// It decides what this browser shows and does. Nothing on a server depends on it: photo ground sends nothing and
// reads nothing from the account, so there is no data for a gate on a server to protect.
import { type PilotRole, usePilotRole } from "@/lib/pilot/access";

type Env = { DEV?: boolean; VITE_FIELD_TWIN_PHOTO_GROUND?: string };
const env = (): Env => { try { return (import.meta.env ?? {}) as Env; } catch { return {}; } };

/** The kill switch: off for everyone in this build. */
export const photoGroundKilled = (e: Env = env()) => e.VITE_FIELD_TWIN_PHOTO_GROUND === "0";

/** The developer's switch: on for everyone, in a development build only. */
export const photoGroundDevFlag = (e: Env = env()) => !photoGroundKilled(e) && !!e.DEV && e.VITE_FIELD_TWIN_PHOTO_GROUND === "1";

/** Whether an account shown as `role` (the founder's preview shows "participant") sees photo ground. */
export function photoGroundAllowed(role: PilotRole | null, e: Env = env()): boolean {
  if (photoGroundKilled(e)) return false;
  return role === "founder" || photoGroundDevFlag(e);
}

/** The same for the signed-in account. False while its role is loading, outside the pilot, and outside the app. */
export function usePhotoGround(): boolean {
  return photoGroundAllowed(usePilotRole());
}
