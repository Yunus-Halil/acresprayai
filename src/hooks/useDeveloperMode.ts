// Developer mode: flags that swap experimental systems in for shipped ones.
//
// Held in localStorage like the unit preference and for the same reasons: it
// is a per-browser preference of the person testing, not data about a field,
// and it must work with no network. Nothing on a farmer's field row records
// that a developer once looked at it through an experimental lens.
//
// Two flags. `weedScout` puts Weed Scout (lib/weedScout) in the Treatment tab;
// it is ON by default since 2026-10-08, when the scout was promoted out of
// developer mode on the founder's instruction. Off brings the Treatment Grid
// back exactly as it was; the grid's stored state is untouched either way.
// `developerTools` adds the Weed Library and Photo Scout to the sidebar.
import { useSyncExternalStore } from "react";
import { storageKey } from "@/lib/storage";

const KEY = storageKey("developer");

export type DeveloperFlags = {
  /** Weed Scout is the Treatment tab. Off: the Treatment Grid. */
  weedScout: boolean;
  /** The Weed Library and Photo Scout in the sidebar. */
  developerTools: boolean;
};

export const DEFAULT_DEVELOPER_FLAGS: DeveloperFlags = { weedScout: true, developerTools: false };

function read(): DeveloperFlags {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DEVELOPER_FLAGS;
    const parsed = JSON.parse(raw) as Partial<DeveloperFlags>;
    // A stored false is a choice to keep the grid; nothing stored is the default.
    return { ...DEFAULT_DEVELOPER_FLAGS, weedScout: parsed.weedScout !== false, developerTools: parsed.developerTools === true };
  } catch {
    return DEFAULT_DEVELOPER_FLAGS;
  }
}

let current: DeveloperFlags = read();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const getDeveloperFlags = (): DeveloperFlags => current;

export function setDeveloperFlag<K extends keyof DeveloperFlags>(flag: K, value: DeveloperFlags[K]): void {
  if (current[flag] === value) return;
  current = { ...current, [flag]: value };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = read();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The developer flags, re-rendering the caller whenever they change. */
export function useDeveloperMode(): DeveloperFlags {
  return useSyncExternalStore(subscribe, getDeveloperFlags, getDeveloperFlags);
}
