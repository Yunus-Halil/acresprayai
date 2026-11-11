// The founder's starred people on the pilot desk: a mark of their own for the people they want to keep an eye on, and
// whether the People list shows everyone or only those.
//
// The stars are kept with the pilot's own data (public.pilot_desk_stars, through the pilot-admin function), so they
// are the same on every device the founder uses. No participant can read them. Pressing a star shows at once and is
// saved behind it; a star that could not be saved is taken back and says so.
//
// A server that does not keep stars yet (the function or the database not updated) is recognised by the snapshot
// carrying none: the stars are then kept in this browser, as they were at first, and are sent up the first time the
// server does keep them. Which view the list shows is always this browser's own.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { storageKey } from "@/lib/storage";
import { pilotAdmin } from "@/lib/pilot/adminClient";
import type { Snapshot } from "@/lib/pilot/adminData";

const STARRED_KEY = storageKey("pilot-desk", "starred");
const VIEW_KEY = storageKey("pilot-desk", "people-view");
const CHANGED = "swardus:starred-changed";

export type PeopleView = "everyone" | "starred";

function readLocal(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STARRED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []);
  } catch { return new Set(); }
}
function writeLocal(ids: Set<string>) { try { localStorage.setItem(STARRED_KEY, JSON.stringify([...ids])); } catch { /* a browser that keeps nothing: the star lasts for this page */ } }
const readView = (): PeopleView => { try { return localStorage.getItem(VIEW_KEY) === "starred" ? "starred" : "everyone"; } catch { return "everyone"; } };

// ---- the stars as this page knows them ----------------------------------------------------------------------------
/** `server`: the snapshot carried the stars, so they are the server's. Otherwise they are this browser's. */
let state: { stars: Set<string>; server: boolean; from: string | null } = { stars: new Set(), server: false, from: null };
let uploaded = false;
const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED)); };

/** Take the stars from a snapshot the first time it is seen (a newer snapshot is the server's present answer). */
function seed(snap: Pick<Snapshot, "generated_at" | "stars"> | null | undefined) {
  const server = Array.isArray(snap?.stars);
  const from = snap ? `${snap.generated_at}|${server}` : null;
  if (from === state.from) return;
  state = { stars: server ? new Set(snap!.stars as string[]) : readLocal(), server, from };
  if (server && !uploaded) { uploaded = true; void sendUpLocalStars(); }
}

/** Stars made in this browser before the server kept them: sent up once, then no longer kept here. */
async function sendUpLocalStars() {
  const local = readLocal();
  if (!local.size) return;
  for (const id of local) {
    if (state.stars.has(id)) continue;
    try { await pilotAdmin("star", { user_id: id, starred: true }); state = { ...state, stars: new Set(state.stars).add(id) }; changed(); }
    catch { /* someone no longer in the pilot, or no connection: that star is let go */ }
  }
  try { localStorage.removeItem(STARRED_KEY); } catch { /* nothing kept */ }
}

async function toggleStar(userId: string) {
  const on = !state.stars.has(userId);
  const next = new Set(state.stars);
  if (on) next.add(userId); else next.delete(userId);
  state = { ...state, stars: next };
  if (!state.server) { writeLocal(next); changed(); return; }
  changed();
  try { await pilotAdmin("star", { user_id: userId, starred: on }); }
  catch (e) {
    // Not saved: the star goes back to what the server has.
    const back = new Set(state.stars);
    if (on) back.delete(userId); else back.add(userId);
    state = { ...state, stars: back };
    changed();
    toast.error(on ? "The star was not saved" : "The star was not removed", { description: (e as Error).message });
  }
}

/**
 * The starred people (by account id), a way to star or unstar one, and the list's view. `snap` is the desk's
 * snapshot: it says whether the server keeps the stars, and which they are.
 */
export function useStarredPeople(snap?: Pick<Snapshot, "generated_at" | "stars"> | null): { starred: Set<string>; toggle: (userId: string) => void; view: PeopleView; setView: (v: PeopleView) => void; synced: boolean } {
  seed(snap);
  const [, redraw] = useState(0);
  const [view, setViewState] = useState(readView);
  useEffect(() => {
    const sync = () => redraw(n => n + 1);
    // Another tab of this browser changed its own stars (only where the browser keeps them) or the view.
    const stored = () => { if (!state.server) state = { ...state, stars: readLocal() }; setViewState(readView()); sync(); };
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", stored);
    return () => { window.removeEventListener(CHANGED, sync); window.removeEventListener("storage", stored); };
  }, []);
  const toggle = useCallback((userId: string) => { void toggleStar(userId); }, []);
  const setView = useCallback((v: PeopleView) => {
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* a browser that keeps nothing */ }
    setViewState(v);
  }, []);
  return { starred: state.stars, toggle, view, setView, synced: state.server };
}

/** Tests only. */
export function __resetStarsForTests() { state = { stars: new Set(), server: false, from: null }; uploaded = false; }
