// Client for the weather function's observation mode — NOAA station data
// nearest an application time, fetched as a SUGGESTION.
//
// Nothing here writes anything. The caller shows the suggestion with its
// station and distance, and only an explicit acceptance turns it into entered
// data with model provenance. A failed or slow lookup resolves to a reason
// string and the dialog behaves exactly as if the feature did not exist —
// logging a flight never waits on a weather call.
import { FN_BASE } from "@/components/app/workspace/constants";

export type ObservationSuggestion = {
  provider: string;
  station: string;
  station_name: string;
  distance_mi: number;
  observed_at: string;
  wind_mph: number | null;
  wind_dir: string | null;
  temp_f: number | null;
};

export type ObservationFailure = {
  reason: "out-of-retention" | "no-station" | "no-observations" | "unavailable" | "bad-time" | "in-the-future";
  detail?: string;
};

// Discriminated on a string kind, not a boolean: this tsconfig runs with
// strict:false, under which boolean-literal discriminants do not narrow.
export type ObservationResult =
  | { kind: "found"; suggestion: ObservationSuggestion }
  | { kind: "failed"; reason: ObservationFailure["reason"]; detail?: string };

/**
 * A local date ("YYYY-MM-DD") and time ("HH:MM") to the UTC instant the
 * browser's timezone says they name. The operator logs in their own local
 * time; the station observations are UTC.
 */
export function applicationInstant(dateYmd: string, timeHm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !/^\d{2}:\d{2}$/.test(timeHm)) return null;
  const d = new Date(`${dateYmd}T${timeHm}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Human line for the failure reasons the UI shows. */
export function observationFailureText(f: ObservationFailure): string {
  switch (f.reason) {
    case "out-of-retention":
      return "This flight is older than the live NWS feed keeps (about 7 days). " +
        "Older reconstruction needs the NCEI archive, which is not wired in — " +
        "enter the conditions you observed.";
    case "no-station":
      return "No NWS observation station covers this location (US coverage only). " +
        "Enter the conditions you observed.";
    case "no-observations":
      return "The nearest station reported nothing within 90 minutes of that time. " +
        "Enter the conditions you observed.";
    case "in-the-future":
      return "The application time is in the future — nothing to look up yet.";
    case "bad-time":
      return "Enter the application date and start time first.";
    default:
      return "The weather lookup is unavailable right now. Enter the conditions you observed.";
  }
}

export async function fetchObservation(
  center: [number, number],
  dateYmd: string,
  timeHm: string,
  timeoutMs = 12_000,
): Promise<ObservationResult> {
  const instant = applicationInstant(dateYmd, timeHm);
  if (!instant) return { kind: "failed", reason: "bad-time" };
  const [lat, lon] = center;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(
      `${FN_BASE}/weather?mode=observation&lat=${lat}&lon=${lon}&time=${encodeURIComponent(instant.toISOString())}`,
      { signal: ctrl.signal },
    );
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== "object") return { kind: "failed", reason: "unavailable" };
    if (j.ok !== true) {
      const reason = (["out-of-retention", "no-station", "no-observations", "bad-time", "in-the-future"]
        .includes(j.reason) ? j.reason : "unavailable") as ObservationFailure["reason"];
      return { kind: "failed", reason, detail: j.detail };
    }
    return {
      kind: "found",
      suggestion: {
        provider: String(j.provider ?? "noaa-nws"),
        station: String(j.station ?? "?"),
        station_name: String(j.station_name ?? j.station ?? "?"),
        distance_mi: Number(j.distance_mi ?? 0),
        observed_at: String(j.observed_at ?? instant.toISOString()),
        wind_mph: j.wind_mph == null ? null : Number(j.wind_mph),
        wind_dir: j.wind_dir == null ? null : String(j.wind_dir),
        temp_f: j.temp_f == null ? null : Number(j.temp_f),
      },
    };
  } catch {
    return { kind: "failed", reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
