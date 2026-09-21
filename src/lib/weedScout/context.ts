// Step 5, first half: the event context.
//
// "You took it in Northern Virginia at 5 pm, it was sunny, in this season."
// Every observation that reaches the database carries where it was, when it
// was in LOCAL time, what season that is at that latitude, and what the
// nearest weather station reported, because a species estimate built from a
// nationwide archive of top-down chips is only as good as the metadata that
// lets it compare like with like. A rosette in Fairfax County in April is a
// different question from the same rosette in Yuma in October.
//
// One provider, NOAA's api.weather.gov, through the weather edge function's
// `context` mode: place and time zone from /points, observation from the
// nearest station. Nothing here is fabricated when the lookup fails; the
// fields stay null and the reason travels with the record.
import { FN_BASE } from "@/components/app/workspace/constants";
import { supabase } from "@/integrations/supabase/client";

export type Season = "winter" | "spring" | "summer" | "autumn";

export type EventContext = {
  capturedAt: string;
  lat: number;
  lng: number;
  /** "Fairfax, VA" style, or null when the point had no relative location. */
  place: string | null;
  timeZone: string | null;
  /** Local wall-clock text, e.g. "5:12 PM", in the field's zone when known. */
  localTime: string | null;
  localDate: string | null;
  season: Season;
  observation: {
    station: string;
    stationName: string;
    distanceMi: number;
    observedAt: string;
    tempF: number | null;
    windMph: number | null;
    windDir: string | null;
    /** NWS textDescription, e.g. "Sunny", when the station reported one. */
    sky: string | null;
  } | null;
  /** Why there is no observation, when there is none. */
  observationReason: string | null;
};

/** Meteorological season for a date at a latitude. Southern hemisphere shifts by six months. */
export function seasonOf(date: Date, lat: number): Season {
  const m = date.getUTCMonth();       // 0..11
  const north: Season[] = [
    "winter", "winter", "spring", "spring", "spring", "summer",
    "summer", "summer", "autumn", "autumn", "autumn", "winter",
  ];
  const s = north[m];
  if (lat >= 0) return s;
  return ({ winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" } as const)[s];
}

/** Local time and date strings for an instant in a zone, or null if the zone is unknown or invalid. */
export function localTimeIn(iso: string, timeZone: string | null): { time: string; date: string } | null {
  if (!timeZone) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return { time, date };
  } catch {
    return null;
  }
}

/** The sentence the operator (and the brain) read. */
export function describeEvent(ctx: EventContext): string {
  const where = ctx.place ? `in ${ctx.place}` : `at ${ctx.lat.toFixed(4)}, ${ctx.lng.toFixed(4)}`;
  const when = ctx.localTime ? `at ${ctx.localTime} local time` : `at ${new Date(ctx.capturedAt).toISOString().slice(11, 16)} UTC`;
  const parts = [`Captured ${where} ${when}, ${ctx.season}.`];
  const o = ctx.observation;
  if (o) {
    const wx: string[] = [];
    if (o.sky) wx.push(o.sky.toLowerCase());
    if (o.tempF != null) wx.push(`${Math.round(o.tempF)} F`);
    if (o.windMph != null) wx.push(`wind ${Math.round(o.windMph)} mph${o.windDir ? ` ${o.windDir}` : ""}`);
    parts.push(
      `${wx.length ? wx.join(", ") : "Conditions reported"} at ${o.stationName} ` +
      `(${o.distanceMi.toFixed(0)} mi away, ${new Date(o.observedAt).toISOString().slice(0, 16).replace("T", " ")} UTC).`,
    );
  } else if (ctx.observationReason) {
    parts.push(`No station observation: ${ctx.observationReason}.`);
  }
  return parts.join(" ");
}

/** Build a context from the edge function's `mode=context` reply. Pure, so it is testable. */
export function contextFromReply(
  reply: Record<string, unknown> | null,
  lat: number, lng: number, capturedAt: string,
): EventContext {
  const r = reply ?? {};
  const place = typeof r.place === "string" && r.place ? r.place : null;
  const timeZone = typeof r.time_zone === "string" && r.time_zone ? r.time_zone : null;
  const local = localTimeIn(capturedAt, timeZone);
  const obs = r.observation && typeof r.observation === "object" ? r.observation as Record<string, unknown> : null;
  const observation = obs && obs.ok === true
    ? {
        station: String(obs.station ?? "?"),
        stationName: String(obs.station_name ?? obs.station ?? "?"),
        distanceMi: Number(obs.distance_mi ?? 0),
        observedAt: String(obs.observed_at ?? capturedAt),
        tempF: obs.temp_f == null ? null : Number(obs.temp_f),
        windMph: obs.wind_mph == null ? null : Number(obs.wind_mph),
        windDir: obs.wind_dir == null ? null : String(obs.wind_dir),
        sky: typeof obs.sky === "string" && obs.sky ? obs.sky : null,
      }
    : null;
  const observationReason = observation
    ? null
    : (obs && typeof obs.detail === "string" && obs.detail)
      || (obs && typeof obs.reason === "string" && obs.reason)
      || (typeof r.error === "string" ? r.error : "lookup unavailable");
  return {
    capturedAt, lat, lng, place, timeZone,
    localTime: local?.time ?? null,
    localDate: local?.date ?? null,
    season: seasonOf(new Date(capturedAt), lat),
    observation,
    observationReason,
  };
}

/**
 * Fetch the context for a capture. Never throws: a failed lookup yields a
 * context with nulls and a reason, and the pipeline goes on without it.
 */
export async function fetchEventContext(
  lat: number, lng: number, capturedAt: string, timeoutMs = 12_000,
): Promise<EventContext> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const url = `${FN_BASE}/weather?mode=context&lat=${lat}&lon=${lng}&time=${encodeURIComponent(capturedAt)}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return contextFromReply(json && typeof json === "object" ? json : null, lat, lng, capturedAt);
  } catch (e) {
    return contextFromReply({ error: String((e as Error)?.message ?? e) }, lat, lng, capturedAt);
  } finally {
    clearTimeout(timer);
  }
}
