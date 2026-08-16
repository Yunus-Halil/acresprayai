// Namespaced browser-storage keys.
//
// Everything the app persists locally lives under one prefix so the whole
// namespace is greppable, and so a rename like AcreSpray -> SwathWise is a
// one-line change rather than a hunt through four files.

export const STORAGE_PREFIX = "swathwise";

/** Previous prefixes, newest last. Used only by the one-time migration below. */
const LEGACY_PREFIXES = ["acrespray"];

export const storageKey = (...parts: (string | number)[]) =>
  [STORAGE_PREFIX, ...parts].join(".");

/**
 * Move anything saved under an old prefix across to the current one.
 *
 * The product rename would otherwise silently orphan a farmer's saved pilot
 * name, pinned weather locations, and — the one that actually costs something —
 * an in-flight upload checkpoint, which is what stops a dropped connection from
 * re-sending images that already landed.
 *
 * Idempotent, and never overwrites a value already stored under the new key.
 * Safe to call on every boot.
 */
export function migrateLegacyStorage(): void {
  try {
    for (const legacy of LEGACY_PREFIXES) {
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`${legacy}.`)) stale.push(key);
      }
      for (const key of stale) {
        const next = `${STORAGE_PREFIX}.${key.slice(legacy.length + 1)}`;
        if (localStorage.getItem(next) === null) {
          const value = localStorage.getItem(key);
          if (value !== null) localStorage.setItem(next, value);
        }
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Private mode or a full quota. Losing cached preferences is survivable;
    // failing to boot over it is not.
  }
}
