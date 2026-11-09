// Errors the participant never sees in a console: recorded as client_error events (scrubbed: lib/pilot/telemetry),
// the last one kept so a feedback message can carry it, and a page that failed because Swardus was updated while it
// was open told to reload instead of breaking.
import { track } from "./telemetry";

let last: { message: string; at: string } | null = null;
let installed = false;
const seen = new Map<string, number>();

export const lastClientError = () => last;

/** A failed lazy chunk after a deploy: the page names a file the new deployment no longer has. */
export function isStaleChunkError(message: string): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed/i.test(message);
}

/** Record an error, at most once a minute per message. */
export function recordClientError(error: unknown, where: string): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  last = { message, at: new Date().toISOString() };
  const now = Date.now();
  if ((seen.get(message) ?? 0) > now - 60_000) return;
  seen.set(message, now);
  track("client_error", { outcome: "error", error: message, detail: { where, stale: isStaleChunkError(message) } });
}

/** Window-level handlers: uncaught errors and unhandled promise rejections. Installed once from main.tsx. */
export function installErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", e => recordClientError(e.error ?? e.message, "window"));
  window.addEventListener("unhandledrejection", e => recordClientError(e.reason, "promise"));
}
