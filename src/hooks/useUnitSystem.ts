// The unit preference, held once for the whole app.
//
// WHY NOT IN THE DATABASE. `unit_system` already exists on FarmerSettings,
// which lives in `fields.settings` — per FIELD. That is the wrong scope for
// this: Dashboard, Fields and Fleet span every field a user owns, so there is
// no single field whose preference they could honour. A user-level home would
// mean a `profiles` column, and that needs a migration which cannot currently
// be pushed to this project (the CLI is authenticated as an account without
// access; two migrations are already waiting).
//
// So it lives in localStorage, which is also the right answer on its own
// merits: it is a display preference rather than data, it survives with no
// network, and this app is aimed at people working where there isn't one. The
// basemap choice already works exactly this way.
//
// The per-field value is not abandoned — it seeds this store the first time a
// user arrives without a saved preference, so anyone who already set metric on
// a field keeps it.
import { useSyncExternalStore } from "react";
import type { UnitSystem } from "@/lib/units";

const KEY = "swathwise.units";

const isSystem = (v: unknown): v is UnitSystem => v === "metric" || v === "imperial";

function read(): UnitSystem | null {
  try {
    const raw = localStorage.getItem(KEY);
    return isSystem(raw) ? raw : null;
  } catch {
    return null;   // private mode, or storage disabled
  }
}

// Cached rather than read per call: useSyncExternalStore calls the snapshot on
// every render and must get a referentially stable answer, and localStorage
// reads are synchronous disk-backed work.
let current: UnitSystem = read() ?? "imperial";

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getUnitSystem(): UnitSystem {
  return current;
}

export function setUnitSystem(next: UnitSystem): void {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  emit();
}

/**
 * Adopt a field's stored preference, but only if the user has never chosen one
 * here. An explicit choice must never be overwritten by opening a field that
 * was configured before this setting became site-wide.
 */
export function seedUnitSystem(fromField: UnitSystem | null | undefined): void {
  if (!isSystem(fromField)) return;
  if (read() !== null) return;      // the user has already decided
  setUnitSystem(fromField);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Another tab changing the preference should move this one too — the same
  // farm office often has the workspace open twice.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    const next = isSystem(e.newValue) ? e.newValue : "imperial";
    if (next === current) return;
    current = next;
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The current unit system, re-rendering the caller whenever it changes. */
export function useUnitSystem(): UnitSystem {
  return useSyncExternalStore(subscribe, getUnitSystem, getUnitSystem);
}
