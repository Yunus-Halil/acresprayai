// Developer mode: flags that swap experimental systems in for shipped ones.
//
// Held in localStorage like the unit preference and for the same reasons: it
// is a per-browser preference of the person testing, not data about a field,
// and it must work with no network. Nothing on a farmer's field row records
// that a developer once looked at it through an experimental lens.
//
// Currently one flag. `weedScout` replaces the Treatment Grid tab with the
// experimental Weed Scout pipeline (lib/weedScout). The grid's stored state is
// untouched while the flag is on; turning it off brings the grid back exactly
// as it was.
import { useSyncExternalStore } from "react";
import { storageKey } from "@/lib/storage";

const KEY = storageKey("developer");

export type DeveloperFlags = {
  weedScout: boolean;
};

export const DEFAULT_DEVELOPER_FLAGS: DeveloperFlags = { weedScout: false };

function read(): DeveloperFlags {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DEVELOPER_FLAGS;
    const parsed = JSON.parse(raw) as Partial<DeveloperFlags>;
    return { ...DEFAULT_DEVELOPER_FLAGS, weedScout: parsed.weedScout === true };
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
