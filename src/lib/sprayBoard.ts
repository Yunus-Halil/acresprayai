// The dashboard's question, as opposed to the field tab's.
//
// A per-field weather tab answers "what is the weather at this field?". Standing
// at the dashboard with eight fields and a week of scheduled work, the operator
// is asking something the per-field tab structurally cannot answer:
//
//   Across all my fields, where and when can I spray, and does that break
//   anything I have already committed to?
//
// This module answers exactly that, and nothing here touches the DOM or the
// network, so all of it is testable.
import type { ScheduledMission } from "./schedule";
import {
  type SprayHour, type SprayLimits, type SprayWindow, type VerdictResult,
  findSprayWindows, rainAhead, sprayVerdict, verdictRank,
} from "./sprayWindow";

export type BoardSite = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** "field" when auto-pinned from a real field, "manual" when typed in. */
  source?: "field" | "manual";
};

export type SiteOutlook = {
  site: BoardSite;
  /** null while loading, or when the forecast could not be fetched. */
  now: VerdictResult | null;
  windows: SprayWindow[];
  /** The window to act on: one already open, else the soonest ahead. */
  nextWindow: SprayWindow | null;
  /** Hours until nextWindow opens. 0 when it is already open, null when there is none. */
  hoursUntil: number | null;
  error: string | null;
};

/**
 * Turn one site's hourly forecast into the row the board shows.
 *
 * `now` is judged from the first forecast hour rather than a separate "current
 * conditions" reading, so the badge and the strip underneath it can never
 * disagree.
 */
export function outlookFor(
  site: BoardSite,
  hourly: SprayHour[] | null,
  opts: { now?: number; limits?: SprayLimits; error?: string | null } = {},
): SiteOutlook {
  const nowMs = opts.now ?? Date.now();
  if (opts.error) {
    return { site, now: null, windows: [], nextWindow: null, hoursUntil: null, error: opts.error };
  }
  if (!hourly?.length) {
    return { site, now: null, windows: [], nextWindow: null, hoursUntil: null, error: null };
  }

  const now = sprayVerdict(hourly[0], rainAhead(hourly, 0), opts.limits);
  const windows = findSprayWindows(hourly, { limits: opts.limits, now: nowMs });
  const nowSec = nowMs / 1000;
  const nextWindow = windows.find(w => w.active) ?? windows.find(w => w.startTs > nowSec) ?? null;
  const hoursUntil = nextWindow
    ? Math.max(0, Math.round((nextWindow.startTs - nowSec) / 3600))
    : null;

  return { site, now, windows, nextWindow, hoursUntil, error: null };
}

/**
 * Board order: what to act on first.
 *
 * Sites you can spray right now come first, then the ones opening soonest, then
 * the ones with no window at all. Sites whose forecast failed sink to the
 * bottom rather than being dropped, because a field silently missing from the
 * board reads as "nothing to do here".
 */
export function sortOutlooks(rows: SiteOutlook[]): SiteOutlook[] {
  const key = (r: SiteOutlook): [number, number, string] => {
    if (r.error) return [3, 0, r.site.name];
    if (!r.now) return [2, 0, r.site.name];
    if (r.nextWindow?.active) return [0, verdictRank(r.now.verdict), r.site.name];
    if (r.nextWindow) return [1, r.nextWindow.startTs, r.site.name];
    return [2, 1, r.site.name];
  };
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || Number(ka[1]) - Number(kb[1]) || String(ka[2]).localeCompare(String(kb[2]));
  });
}

export type BoardSummary = {
  total: number;
  sprayableNow: number;
  openingSoon: number;
  noWindow: number;
  unavailable: number;
};

/** `openingSoon` counts windows opening within `soonHours`, default 24. */
export function summarise(rows: SiteOutlook[], soonHours = 24): BoardSummary {
  const s: BoardSummary = { total: rows.length, sprayableNow: 0, openingSoon: 0, noWindow: 0, unavailable: 0 };
  for (const r of rows) {
    if (r.error || !r.now) s.unavailable++;
    else if (r.nextWindow?.active) s.sprayableNow++;
    else if (r.hoursUntil != null && r.hoursUntil <= soonHours) s.openingSoon++;
    else s.noWindow++;
  }
  return s;
}

// --- scheduled work, checked against the forecast ----------------------------

export type MissionCheck = {
  mission: ScheduledMission;
  /** The pin the mission was matched to, or null when nothing matched. */
  site: BoardSite | null;
  /** null when the forecast does not reach the scheduled hour. */
  verdict: VerdictResult | null;
  /** True when the mission is further out than the forecast goes. */
  beyondForecast: boolean;
  scheduledMs: number;
};

/** Metres between two coordinates, good enough for matching a pin to a field. */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(midLat);
  return Math.hypot(dLat, x) * R;
}

/** A mission and a pin are the same place within this distance. */
export const SITE_MATCH_RADIUS_M = 2000;

/**
 * Which pin a scheduled mission belongs to.
 *
 * The field id is authoritative: auto-pinned sites are keyed `field:<id>`, so
 * an exact match is exact. Coordinates are only a fallback, for missions saved
 * with a location but no field, and they are bounded by SITE_MATCH_RADIUS_M so
 * a mission never inherits the weather of a farm on the other side of the
 * county.
 */
export function matchSite(mission: ScheduledMission, sites: BoardSite[]): BoardSite | null {
  if (mission.fieldId) {
    const byId = sites.find(s => s.id === `field:${mission.fieldId}`);
    if (byId) return byId;
  }
  const loc = mission.location;
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;

  let best: BoardSite | null = null;
  let bestD = Infinity;
  for (const s of sites) {
    const d = distanceM(loc, s);
    if (d < bestD) { bestD = d; best = s; }
  }
  return bestD <= SITE_MATCH_RADIUS_M ? best : null;
}

/**
 * Check every scheduled mission against the forecast where it will fly.
 *
 * A mission past the end of the forecast is reported as `beyondForecast`, not
 * as safe. The distinction matters: "we cannot know yet" and "it is fine" look
 * identical on a calendar and mean opposite things to someone deciding whether
 * to mix a tank tonight.
 */
export function checkScheduled(
  missions: ScheduledMission[],
  sites: BoardSite[],
  hourlyBySiteId: Map<string, SprayHour[]>,
  limits?: SprayLimits,
): MissionCheck[] {
  const HALF_HOUR_SEC = 1800;
  return missions
    .map((mission): MissionCheck => {
      const scheduledMs = new Date(mission.scheduledAt).getTime();
      const site = matchSite(mission, sites);
      const hourly = site ? hourlyBySiteId.get(site.id) : undefined;

      if (!site || !hourly?.length || !Number.isFinite(scheduledMs)) {
        return { mission, site, verdict: null, beyondForecast: false, scheduledMs };
      }
      const whenSec = scheduledMs / 1000;
      const i = hourly.findIndex(h => Math.abs(h.time - whenSec) <= HALF_HOUR_SEC);
      if (i < 0) {
        return { mission, site, verdict: null, beyondForecast: true, scheduledMs };
      }
      return {
        mission, site, scheduledMs, beyondForecast: false,
        verdict: sprayVerdict(hourly[i], rainAhead(hourly, i), limits),
      };
    })
    .sort((a, b) => a.scheduledMs - b.scheduledMs);
}

/** Only the checks worth interrupting someone about: a confirmed red or yellow. */
export function conflictsOnly(checks: MissionCheck[]): MissionCheck[] {
  return checks.filter(c => c.verdict && c.verdict.verdict !== "green");
}

/**
 * The best alternative for a mission the weather has ruled out.
 *
 * Returns the first window that opens after the scheduled time, so the
 * suggestion is a reschedule rather than a note that yesterday was nicer.
 */
export function suggestedMove(check: MissionCheck, outlook: SiteOutlook | undefined): SprayWindow | null {
  if (!outlook || !check.verdict || check.verdict.verdict === "green") return null;
  const afterSec = check.scheduledMs / 1000;
  return outlook.windows.find(w => w.startTs > afterSec) ?? null;
}
