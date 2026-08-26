// @vitest-environment node
//
// The weather function's observation mode: NOAA station data nearest an
// application time, with the honesty rules enforced server-side — the station
// and its distance always named, out-of-retention answered explicitly rather
// than as an empty success, station nulls preserved rather than invented.
// Also pins the provider policy: the fallback path must never call Open-Meteo
// (whose free tier is non-commercial) and the User-Agent must not leak a
// personal email by default.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDenoGlobal, jsonResponse, loadFunction, mockFetch } from "./harness";

const FN = "../../../supabase/functions/weather/index.ts";

// A moment ~30 hours ago, safely inside NWS retention for the test clock.
const RECENT = new Date(Date.now() - 30 * 3600_000).toISOString();
const OLD = new Date(Date.now() - 21 * 86400_000).toISOString();

const obsReq = (time: string) =>
  new Request(`https://fn/weather?mode=observation&lat=45.01&lon=-93.46&time=${encodeURIComponent(time)}`);

function nwsRoutes() {
  return [
    {
      match: "/points/",
      respond: () => jsonResponse({
        properties: { observationStations: "https://api.weather.gov/gridpoints/MPX/102,74/stations" },
      }),
    },
    {
      match: "/stations?limit=1",
      respond: () => jsonResponse({
        features: [{
          properties: { stationIdentifier: "KMIC", name: "Minneapolis, Crystal Airport" },
          geometry: { coordinates: [-93.35083, 45.0625] },
        }],
      }),
    },
    {
      match: "/observations?",
      respond: () => jsonResponse({
        features: [
          {
            properties: {
              timestamp: RECENT,
              windSpeed: { value: 17.7 },        // km/h ≈ 11 mph
              windDirection: { value: 135 },     // SE
              temperature: { value: 36.1 },      // °C ≈ 97 °F
            },
          },
          {
            properties: {
              timestamp: new Date(new Date(RECENT).getTime() - 80 * 60000).toISOString(),
              windSpeed: { value: 5 },
              windDirection: { value: 10 },
              temperature: { value: 20 },
            },
          },
        ],
      }),
    },
  ];
}

beforeEach(() => { installDenoGlobal(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("weather · observation mode", () => {
  it("returns the closest-in-time observation, converted, with station and distance", async () => {
    const handler = await loadFunction(FN);
    const fetchMock = mockFetch(nwsRoutes());

    const body = await (await handler(obsReq(RECENT))).json();

    expect(body.ok).toBe(true);
    expect(body.provider).toBe("noaa-nws");
    expect(body.station).toBe("KMIC");
    // ~7.6 mi between the test point and Crystal Airport.
    expect(body.distance_mi).toBeGreaterThan(4);
    expect(body.distance_mi).toBeLessThan(12);
    expect(body.wind_mph).toBeCloseTo(11, 0);
    expect(body.wind_dir).toBe("SE");
    expect(body.temp_f).toBeCloseTo(97, 0);
    // Closest report wins, not the first.
    expect(body.observed_at).toBe(RECENT);

    // Every NWS call identified itself, and not with anyone's personal email.
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit?][]) {
      const headers = call[1]?.headers as Record<string, string> | undefined;
      if (String(call[0]).includes("api.weather.gov")) {
        expect(headers?.["User-Agent"]).toMatch(/SwathWise/);
        expect(headers?.["User-Agent"]).not.toMatch(/@/);
      }
    }
  });

  it("answers out-of-retention explicitly, without calling NWS at all", async () => {
    const handler = await loadFunction(FN);
    const fetchMock = mockFetch([]);

    const body = await (await handler(obsReq(OLD))).json();

    expect(body.ok).toBe(false);
    expect(body.reason).toBe("out-of-retention");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a station's nulls — no invented wind for a station that reported none", async () => {
    const handler = await loadFunction(FN);
    const routes = nwsRoutes();
    routes[2] = {
      match: "/observations?",
      respond: () => jsonResponse({
        features: [{
          properties: {
            timestamp: RECENT,
            windSpeed: { value: null },
            windDirection: { value: null },
            temperature: { value: 36.1 },
          },
        }],
      }),
    };
    mockFetch(routes);

    const body = await (await handler(obsReq(RECENT))).json();

    expect(body.ok).toBe(true);
    expect(body.wind_mph).toBeNull();
    expect(body.wind_dir).toBeNull();
    expect(body.temp_f).toBeCloseTo(97, 0);
  });

  it("an empty observation window is a named failure, not an empty success", async () => {
    const handler = await loadFunction(FN);
    const routes = nwsRoutes();
    routes[2] = { match: "/observations?", respond: () => jsonResponse({ features: [] }) };
    mockFetch(routes);

    const body = await (await handler(obsReq(RECENT))).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("no-observations");
  });
});

describe("weather · provider policy", () => {
  it("the keyless forecast path goes to NOAA and never to Open-Meteo", async () => {
    const handler = await loadFunction(FN);
    const fetchMock = mockFetch([
      {
        match: "/points/",
        respond: () => jsonResponse({
          properties: {
            forecastHourly: "https://api.weather.gov/gridpoints/MPX/102,74/forecast/hourly",
            forecast: "https://api.weather.gov/gridpoints/MPX/102,74/forecast",
            timeZone: "America/Chicago",
          },
        }),
      },
      {
        match: "/forecast/hourly",
        respond: () => jsonResponse({
          properties: {
            periods: [{
              startTime: RECENT, temperature: 88, temperatureUnit: "F",
              windSpeed: "5 to 10 mph", windDirection: "SE", isDaytime: true,
              probabilityOfPrecipitation: { value: 20 },
              relativeHumidity: { value: 60 }, shortForecast: "Partly Sunny",
            }],
          },
        }),
      },
      {
        match: /\/forecast$/,
        respond: () => jsonResponse({
          properties: {
            periods: [
              { startTime: RECENT, temperature: 90, temperatureUnit: "F", isDaytime: true,
                windSpeed: "10 mph", windDirection: "S", shortForecast: "Sunny",
                probabilityOfPrecipitation: { value: 0 }, relativeHumidity: { value: 50 } },
              { startTime: RECENT, temperature: 68, temperatureUnit: "F", isDaytime: false,
                windSpeed: "5 mph", windDirection: "S", shortForecast: "Clear",
                probabilityOfPrecipitation: { value: 0 }, relativeHumidity: { value: 70 } },
            ],
          },
        }),
      },
    ]);

    const res = await handler(new Request("https://fn/weather?lat=45.01&lon=-93.46"));
    const body = await res.json();

    expect(body.source).toBe("noaa-nws");
    expect(body.current.temp_c).toBeCloseTo((88 - 32) * 5 / 9, 1);
    expect(body.hourly[0].wind_kmh).toBeCloseTo(10 * 1.609344, 1);
    expect(body.daily[0].tmax_c).toBeCloseTo((90 - 32) * 5 / 9, 1);
    expect(body.daily[0].tmin_c).toBeCloseTo((68 - 32) * 5 / 9, 1);

    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toMatch(/open-meteo/);
    }
  });
});
