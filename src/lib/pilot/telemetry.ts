// First-party pilot events (public.app_events, migration 20261109140000): what happened, how long it took, whether it
// worked. Counts, timings and error text only. NEVER pixels, file names, coordinates or field boundaries: those are
// the participant's field data, not telemetry. Events are insert-only for the participant (they cannot read them
// back); the founder reads them through the pilot desk.
//
// Recording never gets in the way: events are queued, sent in small batches, and a failure (offline, the table not
// there yet) is dropped silently. A participant's work never waits on telemetry.
import { supabase } from "@/integrations/supabase/client";

export type EventName =
  | "session_start"
  | "twin_check_done"
  | "twin_build_started" | "twin_build_finished" | "twin_build_failed" | "twin_build_cancelled"
  | "twin_saved" | "twin_save_failed"
  | "twin_opened" | "twin_open_failed" | "twin_deleted"
  | "finding_reviewed"
  | "feedback_sent"
  | "client_error";

export type EventFields = {
  twinId?: string | null;
  durationMs?: number | null;
  outcome?: "ok" | "error" | "cancelled" | null;
  error?: string | null;
  /** Small numbers: photographs, files, findings. */
  counts?: Record<string, number>;
  /** Stage timings, ms. */
  stages?: Record<string, number>;
  /** A few short facts (crop, camera model, stage, route). Strings are cut to 120 characters. */
  detail?: Record<string, string | number | boolean | null>;
};

type Row = {
  name: EventName; at: string; session_id: string; route: string | null; twin_id: string | null;
  duration_ms: number | null; outcome: string | null; error: string | null;
  counts: Record<string, number> | null; stages: Record<string, number> | null; detail: Record<string, unknown> | null;
  app_version: string;
};

const SESSION = (() => { try { return crypto.randomUUID(); } catch { return `s${Date.now().toString(36)}`; } })();
const VERSION = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";
const queue: Row[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strip anything that could carry field data out of an error message: coordinates, file paths, long numbers. */
export function scrub(text: string | null | undefined, max = 500): string | null {
  if (!text) return null;
  return String(text)
    .replace(/-?\d{1,3}\.\d{4,}/g, "<num>")
    .replace(/[\w-]+\.(jpe?g|tiff?|dng|png|json|gz)\b/gi, "<file>")
    .replace(/(\/[\w.-]+){2,}/g, "<path>")
    .slice(0, max);
}

function cleanDetail(d: EventFields["detail"]): Record<string, unknown> | null {
  if (!d) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d).slice(0, 12)) out[k.slice(0, 40)] = typeof v === "string" ? scrub(v, 120) : v;
  return out;
}

function cleanNumbers(n: Record<string, number> | undefined): Record<string, number> | null {
  if (!n) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(n).slice(0, 24)) if (Number.isFinite(v)) out[k.slice(0, 40)] = Math.round(v);
  return out;
}

async function flush() {
  timer = null;
  if (!queue.length || !enabled) return;
  const batch = queue.splice(0, 20);
  try {
    const { error } = await supabase.from("app_events").insert(batch as never);
    // The table not being there yet (database not updated) stops recording for this page; nothing else does.
    if (error && /does not exist|PGRST205|schema cache/i.test(`${error.code ?? ""} ${error.message}`)) enabled = false;
  } catch { /* offline: dropped */ }
  if (queue.length) timer = setTimeout(() => void flush(), 2_000);
}

/** Record one event. Never throws, never waits. */
export function track(name: EventName, f: EventFields = {}): void {
  if (!enabled) return;
  try {
    queue.push({
      name, at: new Date().toISOString(), session_id: SESSION,
      route: typeof location !== "undefined" ? location.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id").slice(0, 120) : null,
      twin_id: f.twinId && UUID.test(f.twinId) ? f.twinId : null,
      duration_ms: f.durationMs != null && Number.isFinite(f.durationMs) ? Math.round(f.durationMs) : null,
      outcome: f.outcome ?? null,
      error: scrub(f.error),
      counts: cleanNumbers(f.counts),
      stages: cleanNumbers(f.stages),
      detail: cleanDetail(f.detail),
      app_version: VERSION,
    });
    if (queue.length > 200) queue.splice(0, queue.length - 200);
    if (!timer) timer = setTimeout(() => void flush(), 1_500);
  } catch { /* never in the way */ }
}

/** Send what is queued now (before the page goes away). */
export function flushNow(): void { if (timer) { clearTimeout(timer); timer = null; } void flush(); }

/** Tests only. */
export const __telemetry = { queue, reset: () => { queue.length = 0; enabled = true; if (timer) clearTimeout(timer); timer = null; } };
