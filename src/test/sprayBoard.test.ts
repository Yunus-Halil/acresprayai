// The dashboard's cross-field logic: which fields are flyable, in what order,
// and whether anything already on the calendar is about to fly into a gust.
import { describe, it, expect } from "vitest";
import type { ScheduledMission } from "@/lib/schedule";
import type { SprayHour } from "@/lib/sprayWindow";
import {
  type BoardSite, type MissionCheck, SITE_MATCH_RADIUS_M, checkScheduled,
  conflictsOnly, matchSite, outlookFor, sortOutlooks, suggestedMove, summarise,
} from "@/lib/sprayBoard";

const HOUR = 3600;
const T0 = Math.floor(Date.UTC(2026, 7, 20, 6, 0, 0) / 1000);
const NOW_MS = T0 * 1000;

const hour = (over: Partial<SprayHour>, i: number): SprayHour => ({
  time: T0 + i * HOUR,
  temp_c: 20, humidity: 55, wind_kmh: 8, gust_kmh: 12, precip_mm: 0,
  ...over,
});
const series = (n: number, f: (i: number) => Partial<SprayHour> = () => ({})) =>
  Array.from({ length: n }, (_, i) => hour(f(i), i));

const site = (id: string, over: Partial<BoardSite> = {}): BoardSite =>
  ({ id, name: id, lat: 40, lng: -95, ...over });

const mission = (over: Partial<ScheduledMission> = {}): ScheduledMission => ({
  id: "m1", fieldId: null, scanId: null, flightPlanId: null,
  scheduledAt: new Date((T0 + 4 * HOUR) * 1000).toISOString(),
  location: null, droneId: null, status: "scheduled",
  chemical: null, notes: null, stats: null,
  createdAt: new Date(NOW_MS).toISOString(),
  ...over,
});

describe("one site's outlook", () => {
  it("reports the current verdict and the window that is already open", () => {
    const r = outlookFor(site("a"), series(48), { now: NOW_MS });
    expect(r.now?.verdict).toBe("green");
    expect(r.nextWindow?.active).toBe(true);
    expect(r.hoursUntil).toBe(0);
  });

  it("points at the next window when now is unflyable", () => {
    // Windy for six hours, then calm.
    const r = outlookFor(site("a"), series(48, i => ({ wind_kmh: i < 6 ? 40 : 8 })), { now: NOW_MS });
    expect(r.now?.verdict).toBe("red");
    expect(r.nextWindow?.active).toBe(false);
    expect(r.hoursUntil).toBe(6);
  });

  it("says there is no window rather than inventing one", () => {
    const r = outlookFor(site("a"), series(48, () => ({ wind_kmh: 50 })), { now: NOW_MS });
    expect(r.nextWindow).toBeNull();
    expect(r.hoursUntil).toBeNull();
    expect(r.now?.verdict).toBe("red");
  });

  it("keeps a failed fetch distinguishable from bad weather", () => {
    // Both render as "cannot fly", and they are not the same thing at all.
    const r = outlookFor(site("a"), null, { now: NOW_MS, error: "offline" });
    expect(r.error).toBe("offline");
    expect(r.now).toBeNull();
  });

  it("judges now from the first forecast hour, so the badge matches the strip", () => {
    const r = outlookFor(site("a"), series(48, i => ({ wind_kmh: i === 0 ? 40 : 8 })), { now: NOW_MS });
    expect(r.now?.verdict).toBe("red");
  });
});

describe("board order", () => {
  it("puts fly-now first, then soonest, then never, then broken", () => {
    const rows = [
      outlookFor(site("never"), series(48, () => ({ wind_kmh: 50 })), { now: NOW_MS }),
      outlookFor(site("broken"), null, { now: NOW_MS, error: "offline" }),
      outlookFor(site("later"), series(48, i => ({ wind_kmh: i < 20 ? 40 : 8 })), { now: NOW_MS }),
      outlookFor(site("now"), series(48), { now: NOW_MS }),
      outlookFor(site("soon"), series(48, i => ({ wind_kmh: i < 5 ? 40 : 8 })), { now: NOW_MS }),
    ];
    expect(sortOutlooks(rows).map(r => r.site.id))
      .toEqual(["now", "soon", "later", "never", "broken"]);
  });

  it("does not drop a site whose forecast failed", () => {
    // A field silently missing from the board reads as "nothing to do here".
    const rows = [outlookFor(site("a"), null, { error: "boom" }), outlookFor(site("b"), series(24), { now: NOW_MS })];
    expect(sortOutlooks(rows)).toHaveLength(2);
  });

  it("does not mutate the array it was given", () => {
    const rows = [outlookFor(site("z"), series(24), { now: NOW_MS }), outlookFor(site("a"), null, { error: "x" })];
    const before = rows.map(r => r.site.id);
    sortOutlooks(rows);
    expect(rows.map(r => r.site.id)).toEqual(before);
  });
});

describe("the summary line", () => {
  it("counts each field exactly once", () => {
    const rows = [
      outlookFor(site("now"), series(48), { now: NOW_MS }),
      outlookFor(site("soon"), series(48, i => ({ wind_kmh: i < 5 ? 40 : 8 })), { now: NOW_MS }),
      outlookFor(site("never"), series(48, () => ({ wind_kmh: 50 })), { now: NOW_MS }),
      outlookFor(site("broken"), null, { error: "offline" }),
    ];
    const s = summarise(rows);
    expect(s).toEqual({ total: 4, sprayableNow: 1, openingSoon: 1, noWindow: 1, unavailable: 1 });
    expect(s.sprayableNow + s.openingSoon + s.noWindow + s.unavailable).toBe(s.total);
  });

  it("treats a window past the horizon as not soon", () => {
    const rows = [outlookFor(site("late"), series(72, i => ({ wind_kmh: i < 40 ? 40 : 8 })), { now: NOW_MS })];
    expect(summarise(rows, 24).openingSoon).toBe(0);
    expect(summarise(rows, 48).openingSoon).toBe(1);
  });
});

describe("matching a mission to a pin", () => {
  it("prefers the field id, which is exact", () => {
    const sites = [site("field:abc"), site("other", { lat: 40.0001, lng: -95.0001 })];
    expect(matchSite(mission({ fieldId: "abc" }), sites)?.id).toBe("field:abc");
  });

  it("falls back to the nearest pin when there is no field", () => {
    const sites = [site("far", { lat: 41, lng: -95 }), site("near", { lat: 40.001, lng: -95.001 })];
    expect(matchSite(mission({ location: { lat: 40, lng: -95 } }), sites)?.id).toBe("near");
  });

  it("refuses a pin on the other side of the county", () => {
    // Better no weather than a neighbouring farm's weather.
    const sites = [site("far", { lat: 41, lng: -95 })];
    expect(matchSite(mission({ location: { lat: 40, lng: -95 } }), sites)).toBeNull();
  });

  it("matches right up to the radius and not past it", () => {
    const degPerM = 1 / 111_320;
    const inside = site("in", { lat: 40 + (SITE_MATCH_RADIUS_M * 0.9) * degPerM, lng: -95 });
    const outside = site("out", { lat: 40 + (SITE_MATCH_RADIUS_M * 1.5) * degPerM, lng: -95 });
    const m = mission({ location: { lat: 40, lng: -95 } });
    expect(matchSite(m, [inside])?.id).toBe("in");
    expect(matchSite(m, [outside])).toBeNull();
  });

  it("returns null when there is neither a field nor a location", () => {
    expect(matchSite(mission(), [site("a")])).toBeNull();
  });
});

describe("checking the calendar against the forecast", () => {
  const sites = [site("field:abc")];
  const byId = (h: SprayHour[]) => new Map([["field:abc", h]]);

  it("flags a mission scheduled into a gust", () => {
    const m = mission({ fieldId: "abc" });   // hour 4
    const checks = checkScheduled([m], sites, byId(series(48, i => ({ gust_kmh: i === 4 ? 40 : 12 }))));
    expect(checks[0].verdict?.verdict).toBe("red");
    expect(checks[0].verdict?.headline?.kind).toBe("gust");
    expect(conflictsOnly(checks)).toHaveLength(1);
  });

  it("leaves a mission in clear air alone", () => {
    const checks = checkScheduled([mission({ fieldId: "abc" })], sites, byId(series(48)));
    expect(checks[0].verdict?.verdict).toBe("green");
    expect(conflictsOnly(checks)).toHaveLength(0);
  });

  it("says 'too far out to know' rather than 'fine'", () => {
    // "We cannot know yet" and "it is fine" look identical on a calendar and
    // mean opposite things to someone deciding whether to mix a tank tonight.
    const m = mission({ fieldId: "abc", scheduledAt: new Date((T0 + 200 * HOUR) * 1000).toISOString() });
    const checks = checkScheduled([m], sites, byId(series(48)));
    expect(checks[0].beyondForecast).toBe(true);
    expect(checks[0].verdict).toBeNull();
    expect(conflictsOnly(checks)).toHaveLength(0);
  });

  it("does not claim a forecast for a mission it could not place", () => {
    const checks = checkScheduled([mission({ fieldId: "somewhere-else" })], sites, byId(series(48)));
    expect(checks[0].site).toBeNull();
    expect(checks[0].verdict).toBeNull();
    expect(checks[0].beyondForecast).toBe(false);
  });

  it("survives a mission with an unparseable date", () => {
    const checks = checkScheduled([mission({ fieldId: "abc", scheduledAt: "not a date" })], sites, byId(series(48)));
    expect(checks[0].verdict).toBeNull();
  });

  it("returns them in the order they will happen", () => {
    const ms = [
      mission({ id: "c", fieldId: "abc", scheduledAt: new Date((T0 + 20 * HOUR) * 1000).toISOString() }),
      mission({ id: "a", fieldId: "abc", scheduledAt: new Date((T0 + 2 * HOUR) * 1000).toISOString() }),
      mission({ id: "b", fieldId: "abc", scheduledAt: new Date((T0 + 9 * HOUR) * 1000).toISOString() }),
    ];
    expect(checkScheduled(ms, sites, byId(series(48))).map(c => c.mission.id)).toEqual(["a", "b", "c"]);
  });
});

describe("suggesting a new time", () => {
  const sites = [site("field:abc")];

  it("offers the next window after the scheduled slot, not before it", () => {
    // Hour 4 is a gust; hours 0-3 were fine but are in the past relative to the
    // booking, so suggesting them would be a note that yesterday was nicer.
    const hourly = series(48, i => ({ gust_kmh: i === 4 ? 40 : 12 }));
    const check = checkScheduled([mission({ fieldId: "abc" })], sites, new Map([["field:abc", hourly]]))[0];
    const out = outlookFor(sites[0], hourly, { now: NOW_MS });
    const move = suggestedMove(check, out);
    expect(move).not.toBeNull();
    expect(move!.startTs).toBeGreaterThan(check.scheduledMs / 1000);
  });

  it("offers nothing when the mission is already fine", () => {
    const hourly = series(48);
    const check = checkScheduled([mission({ fieldId: "abc" })], sites, new Map([["field:abc", hourly]]))[0];
    expect(suggestedMove(check, outlookFor(sites[0], hourly, { now: NOW_MS }))).toBeNull();
  });

  it("offers nothing when the rest of the week is unflyable", () => {
    const hourly = series(48, () => ({ wind_kmh: 50 }));
    const check = checkScheduled([mission({ fieldId: "abc" })], sites, new Map([["field:abc", hourly]]))[0];
    expect(suggestedMove(check, outlookFor(sites[0], hourly, { now: NOW_MS }))).toBeNull();
  });

  it("offers nothing when there is no outlook to draw from", () => {
    const check = { verdict: { verdict: "red", reasons: [], headline: null }, scheduledMs: NOW_MS } as MissionCheck;
    expect(suggestedMove(check, undefined)).toBeNull();
  });
});
