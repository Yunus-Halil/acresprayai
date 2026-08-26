// Weather, from two jobs and one provider policy.
//
// FORECAST (default): proxies OpenWeather One Call 3.0 when a key is
// configured (the key never leaves the server), falling back to NOAA's
// api.weather.gov. The old fallback was Open-Meteo's free API, whose terms
// are explicitly non-commercial — a live licensing problem for a product
// with paying operators. NOAA is US-government public domain: free, no key,
// no commercial restriction, and the audience is Part 137 operators flying
// in the US, so a US-only provider fits.
//
// OBSERVATION (?mode=observation&lat&lon&time=ISO): the nearest NWS station's
// observation closest to a given time — for the Log Flight dialog's
// SUGGESTION flow. Two honesty rules live here rather than in the UI alone:
//   1. The response always names the station and its distance from the field.
//      An airport anemometer miles away is NOT the field at boom height, and
//      whoever sees the value must see that with it.
//   2. api.weather.gov retains roughly 7 days of observations. Older requests
//      return an explicit "out-of-retention" answer, never an empty success.
//      The NCEI archive would cover older flights but uses a different
//      station-ID system (ISD, needing an isd-history mapping) and lags weeks
//      behind on recent data — verified empirically before this was written —
//      so it is deliberately NOT wired; a lookup that silently fails on the
//      flights that need it most is worse than saying "enter it manually".
//
// NOAA asks API users to identify themselves via User-Agent. Set the
// WEATHER_CONTACT secret to a contact email/URL; the default names the app.
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const NWS = "https://api.weather.gov";
const NWS_RETENTION_DAYS = 8;

const nwsHeaders = () => ({
  "User-Agent": `SwathWise (${Deno.env.get("WEATHER_CONTACT") ?? "https://swathwise.com"})`,
  "Accept": "application/geo+json",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lon = parseFloat(url.searchParams.get("lon") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: "lat/lon required" }, 400);
  }

  if (url.searchParams.get("mode") === "observation") {
    try {
      return json(await nwsObservation(lat, lon, url.searchParams.get("time") ?? ""));
    } catch (e) {
      return json({ ok: false, reason: "unavailable", detail: String((e as Error)?.message ?? e) });
    }
  }

  try {
    const key = Deno.env.get("OPENWEATHER_API_KEY");
    if (!key) {
      const fb = await nwsForecastFallback(lat, lon);
      if (fb) return json(fb);
      return json({ error: "No weather provider available" }, 502);
    }

    const api = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}` +
      `&units=metric&exclude=minutely,alerts&appid=${key}`;
    const r = await fetch(api);
    if (!r.ok) {
      const text = await r.text();
      if (r.status === 401 || r.status === 403 || r.status >= 500) {
        const fb = await nwsForecastFallback(lat, lon);
        if (fb) return json(fb);
      }
      return json({ error: `OpenWeather ${r.status}`, detail: text }, 502);
    }
    const d = await r.json();

    const c = d.current ?? {};
    const current = {
      time: c.dt,
      temp_c: c.temp,
      feels_c: c.feels_like,
      humidity: c.humidity,
      wind_kmh: (c.wind_speed ?? 0) * 3.6,
      gust_kmh: (c.wind_gust ?? 0) * 3.6,
      wind_dir: c.wind_deg ?? 0,
      clouds: c.clouds ?? 0,
      precip_mm: (c.rain?.["1h"] ?? 0) + (c.snow?.["1h"] ?? 0),
      code: c.weather?.[0]?.id ?? 800,
      icon: c.weather?.[0]?.icon ?? "01d",
      desc: c.weather?.[0]?.description ?? "",
    };
    const hourly = (d.hourly ?? []).slice(0, 48).map((h: any) => ({
      time: h.dt,
      temp_c: h.temp,
      humidity: h.humidity,
      wind_kmh: (h.wind_speed ?? 0) * 3.6,
      gust_kmh: (h.wind_gust ?? 0) * 3.6,
      wind_dir: h.wind_deg ?? 0,
      precip_mm: (h.rain?.["1h"] ?? 0) + (h.snow?.["1h"] ?? 0),
      precip_prob: Math.round((h.pop ?? 0) * 100),
      clouds: h.clouds ?? 0,
      code: h.weather?.[0]?.id ?? 800,
      icon: h.weather?.[0]?.icon ?? "01d",
      desc: h.weather?.[0]?.description ?? "",
    }));
    const daily = (d.daily ?? []).slice(0, 7).map((dd: any) => ({
      time: dd.dt,
      tmin_c: dd.temp?.min,
      tmax_c: dd.temp?.max,
      humidity: dd.humidity,
      wind_kmh: (dd.wind_speed ?? 0) * 3.6,
      gust_kmh: (dd.wind_gust ?? 0) * 3.6,
      wind_dir: dd.wind_deg ?? 0,
      precip_mm: dd.rain ?? 0,
      precip_prob: Math.round((dd.pop ?? 0) * 100),
      clouds: dd.clouds ?? 0,
      code: dd.weather?.[0]?.id ?? 800,
      icon: dd.weather?.[0]?.icon ?? "01d",
      desc: dd.weather?.[0]?.description ?? "",
    }));

    return json({ tz: d.timezone, tz_offset: d.timezone_offset, current, hourly, daily });
  } catch (e: any) {
    try {
      const fb = await nwsForecastFallback(lat, lon);
      if (fb) return json(fb);
    } catch { /* fall through to the error */ }
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// NOAA station observation nearest a moment in time
// ---------------------------------------------------------------------------

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const degToCompass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.7613; // miles
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function nwsObservation(lat: number, lon: number, timeIso: string) {
  const t = new Date(timeIso);
  if (!timeIso || Number.isNaN(t.getTime())) {
    return { ok: false, reason: "bad-time", detail: "time=ISO8601 required" };
  }
  // Say out-of-retention up front rather than returning an empty success for
  // a flight logged three weeks late — the caller shows a manual-entry hint.
  const ageDays = (Date.now() - t.getTime()) / 86_400_000;
  if (ageDays > NWS_RETENTION_DAYS) {
    return {
      ok: false,
      reason: "out-of-retention",
      detail: `NWS keeps ~7 days of observations; this time is ${Math.floor(ageDays)} days ago.`,
    };
  }
  if (ageDays < -0.05) {
    return { ok: false, reason: "in-the-future", detail: "Cannot observe a future time." };
  }

  const pRes = await fetch(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: nwsHeaders() });
  if (!pRes.ok) return { ok: false, reason: "unavailable", detail: `points ${pRes.status}` };
  const points = await pRes.json();
  const stationsUrl = points?.properties?.observationStations;
  if (!stationsUrl) return { ok: false, reason: "no-station", detail: "No stations for this point (US only)." };

  const sRes = await fetch(`${stationsUrl}?limit=1`, { headers: nwsHeaders() });
  if (!sRes.ok) return { ok: false, reason: "unavailable", detail: `stations ${sRes.status}` };
  const sJson = await sRes.json();
  const st = sJson?.features?.[0];
  if (!st) return { ok: false, reason: "no-station", detail: "No observation station nearby." };
  const stationId = st.properties?.stationIdentifier as string;
  const stationName = (st.properties?.name as string) ?? stationId;
  const [stLon, stLat] = (st.geometry?.coordinates ?? [lon, lat]) as [number, number];
  const distanceMi = haversineMi(lat, lon, stLat, stLon);

  // ±90 minutes around the application time; pick the closest report.
  const start = new Date(t.getTime() - 90 * 60_000).toISOString();
  const end = new Date(Math.min(Date.now(), t.getTime() + 90 * 60_000)).toISOString();
  const oRes = await fetch(
    `${NWS}/stations/${stationId}/observations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    { headers: nwsHeaders() },
  );
  if (!oRes.ok) return { ok: false, reason: "unavailable", detail: `observations ${oRes.status}` };
  const oJson = await oRes.json();
  const features: any[] = oJson?.features ?? [];
  if (!features.length) {
    return {
      ok: false,
      reason: "no-observations",
      detail: `${stationId} reported nothing within 90 minutes of that time.`,
    };
  }
  let best: any = null;
  let bestGap = Infinity;
  for (const f of features) {
    const ts = new Date(f.properties?.timestamp ?? 0).getTime();
    const gap = Math.abs(ts - t.getTime());
    if (gap < bestGap) { best = f; bestGap = gap; }
  }
  const p = best.properties;
  const windKmh = p.windSpeed?.value as number | null;
  const windDeg = p.windDirection?.value as number | null;
  const tempC = p.temperature?.value as number | null;

  // Nulls stay null: a station that did not report wind gets no invented wind.
  return {
    ok: true,
    provider: "noaa-nws",
    station: stationId,
    station_name: stationName,
    distance_mi: +distanceMi.toFixed(1),
    observed_at: p.timestamp,
    wind_mph: windKmh != null ? +(windKmh * 0.621371).toFixed(1) : null,
    wind_dir: windDeg != null ? degToCompass(windDeg) : null,
    wind_dir_deg: windDeg,
    temp_f: tempC != null ? +((tempC * 9) / 5 + 32).toFixed(1) : null,
  };
}

// ---------------------------------------------------------------------------
// NOAA forecast, mapped to the normalized shape the app already speaks
// ---------------------------------------------------------------------------

/** "5 mph" / "5 to 10 mph" → km/h of the upper figure. */
function parseWindKmh(s: string | null | undefined): number {
  if (!s) return 0;
  const nums = String(s).match(/\d+/g);
  if (!nums?.length) return 0;
  return Number(nums[nums.length - 1]) * 1.609344;
}

const COMPASS16: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

function forecastIcon(shortForecast: string, isDay: boolean): { icon: string; desc: string } {
  const s = shortForecast.toLowerCase();
  const d = isDay ? "d" : "n";
  if (/thunder/.test(s)) return { icon: `11${d}`, desc: s };
  if (/snow|sleet|ice|wintry/.test(s)) return { icon: `13${d}`, desc: s };
  if (/shower|drizzle/.test(s)) return { icon: `09${d}`, desc: s };
  if (/rain/.test(s)) return { icon: `10${d}`, desc: s };
  if (/fog|haze|smoke/.test(s)) return { icon: `50${d}`, desc: s };
  if (/mostly cloudy|overcast/.test(s)) return { icon: `04${d}`, desc: s };
  if (/partly|mostly sunny|mostly clear/.test(s)) return { icon: `02${d}`, desc: s };
  if (/cloudy/.test(s)) return { icon: `03${d}`, desc: s };
  return { icon: `01${d}`, desc: s };
}

const fToC = (f: number) => ((f - 32) * 5) / 9;

async function nwsForecastFallback(lat: number, lon: number) {
  const pRes = await fetch(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: nwsHeaders() });
  if (!pRes.ok) return null;
  const points = await pRes.json();
  const hourlyUrl = points?.properties?.forecastHourly;
  const dailyUrl = points?.properties?.forecast;
  const tz = points?.properties?.timeZone;
  if (!hourlyUrl || !dailyUrl) return null;

  const [hRes, dRes] = await Promise.all([
    fetch(hourlyUrl, { headers: nwsHeaders() }),
    fetch(dailyUrl, { headers: nwsHeaders() }),
  ]);
  if (!hRes.ok || !dRes.ok) return null;
  const hJson = await hRes.json();
  const dJson = await dRes.json();

  const hourly = (hJson?.properties?.periods ?? []).slice(0, 48).map((p: any) => {
    const { icon, desc } = forecastIcon(p.shortForecast ?? "", p.isDaytime !== false);
    return {
      time: Math.floor(new Date(p.startTime).getTime() / 1000),
      temp_c: p.temperatureUnit === "C" ? p.temperature : fToC(p.temperature ?? 0),
      humidity: p.relativeHumidity?.value ?? null,
      wind_kmh: parseWindKmh(p.windSpeed),
      // NWS hourly periods carry no gust; 0 here means "not reported".
      gust_kmh: 0,
      wind_dir: COMPASS16[p.windDirection as string] ?? 0,
      precip_mm: 0,
      precip_prob: p.probabilityOfPrecipitation?.value ?? 0,
      clouds: 0,
      code: 0,
      icon,
      desc,
    };
  });
  if (!hourly.length) return null;
  const current = { ...hourly[0], feels_c: hourly[0].temp_c };

  // Daily comes as 12-hour day/night periods; pair them into calendar days.
  const periods: any[] = dJson?.properties?.periods ?? [];
  const daily: any[] = [];
  for (let i = 0; i < periods.length && daily.length < 7; i++) {
    const p = periods[i];
    if (!p.isDaytime) {
      // A leading night period seeds a day with only a minimum.
      if (daily.length === 0) {
        const { icon, desc } = forecastIcon(p.shortForecast ?? "", false);
        daily.push({
          time: Math.floor(new Date(p.startTime).getTime() / 1000),
          tmin_c: p.temperatureUnit === "C" ? p.temperature : fToC(p.temperature ?? 0),
          tmax_c: null,
          humidity: p.relativeHumidity?.value ?? null,
          wind_kmh: parseWindKmh(p.windSpeed),
          gust_kmh: 0,
          wind_dir: COMPASS16[p.windDirection as string] ?? 0,
          precip_mm: 0,
          precip_prob: p.probabilityOfPrecipitation?.value ?? 0,
          clouds: 0, code: 0, icon, desc,
        });
      } else {
        const day = daily[daily.length - 1];
        const t = p.temperatureUnit === "C" ? p.temperature : fToC(p.temperature ?? 0);
        if (day.tmin_c == null || t < day.tmin_c) day.tmin_c = t;
      }
      continue;
    }
    const { icon, desc } = forecastIcon(p.shortForecast ?? "", true);
    const t = p.temperatureUnit === "C" ? p.temperature : fToC(p.temperature ?? 0);
    daily.push({
      time: Math.floor(new Date(p.startTime).getTime() / 1000),
      tmin_c: t, // refined by the following night period
      tmax_c: t,
      humidity: p.relativeHumidity?.value ?? null,
      wind_kmh: parseWindKmh(p.windSpeed),
      gust_kmh: 0,
      wind_dir: COMPASS16[p.windDirection as string] ?? 0,
      precip_mm: 0,
      precip_prob: p.probabilityOfPrecipitation?.value ?? 0,
      clouds: 0, code: 0, icon, desc,
    });
  }

  return { tz, tz_offset: 0, source: "noaa-nws", current, hourly, daily };
}
