// The founder's starred people on the pilot desk: a mark of their own for the people they want to keep an eye on, and
// whether the People list shows everyone or only those.
//
// Kept in this browser (it is how the founder looks at the desk, not a fact about the participant): nothing is sent
// anywhere, no participant can see it, and another browser starts with none. Shared between this browser's tabs.
import { useCallback, useEffect, useState } from "react";
import { storageKey } from "@/lib/storage";

const STARRED_KEY = storageKey("pilot-desk", "starred");
const VIEW_KEY = storageKey("pilot-desk", "people-view");
const CHANGED = "swardus:starred-changed";

export type PeopleView = "everyone" | "starred";

function readStarred(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STARRED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []);
  } catch { return new Set(); }
}
const readView = (): PeopleView => { try { return localStorage.getItem(VIEW_KEY) === "starred" ? "starred" : "everyone"; } catch { return "everyone"; } };

/** The starred people (by account id), a way to star or unstar one, and the list's view. */
export function useStarredPeople(): { starred: Set<string>; toggle: (userId: string) => void; view: PeopleView; setView: (v: PeopleView) => void } {
  const [starred, setStarred] = useState(readStarred);
  const [view, setViewState] = useState(readView);
  useEffect(() => {
    const sync = () => { setStarred(readStarred()); setViewState(readView()); };
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGED, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(CHANGED, sync); };
  }, []);
  const toggle = useCallback((userId: string) => {
    const next = readStarred();
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    try { localStorage.setItem(STARRED_KEY, JSON.stringify([...next])); } catch { /* a browser that keeps nothing: the star lasts for this page */ }
    setStarred(next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  const setView = useCallback((v: PeopleView) => {
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* as above */ }
    setViewState(v);
  }, []);
  return { starred, toggle, view, setView };
}
