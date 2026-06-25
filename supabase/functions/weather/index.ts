const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Proxies OpenWeather One Call 3.0 so the API key never leaves the server.
// Returns a normalized payload: { current, hourly[48], daily[7], tz }.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const lat = parseFloat(url.searchParams.get("lat") ?? "");
    const lon = parseFloat(url.searchParams.get("lon") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json({ error: "lat/lon required" }, 400);
    }
    const key = Deno.env.get("OPENWEATHER_API_KEY");
    if (!key) return json({ error: "OPENWEATHER_API_KEY not configured" }, 500);

    const api = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}` +
      `&units=metric&exclude=minutely,alerts&appid=${key}`;
    const r = await fetch(api);
    if (!r.ok) {
      const text = await r.text();
      // Fall back to Open-Meteo (no key required) if One Call 3.0 isn't enabled
      // on the account, or for any upstream failure.
      if (r.status === 401 || r.status === 403 || r.status >= 500) {
        const fb = await openMeteoFallback(lat, lon);
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
      const url = new URL(req.url);
      const lat = parseFloat(url.searchParams.get("lat") ?? "");
      const lon = parseFloat(url.searchParams.get("lon") ?? "");
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const fb = await openMeteoFallback(lat, lon);
        if (fb) return json(fb);
      }
    } catch {}
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- Open-Meteo fallback (free, no key) ----------
// Maps Open-Meteo to the same normalized shape this function returns.
async function openMeteoFallback(lat: number, lon: number) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,precipitation,weather_code` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,precipitation_probability,cloud_cover,weather_code` +
    `&daily=temperature_2m_min,temperature_2m_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,precipitation_sum,precipitation_probability_max,weather_code` +
    `&wind_speed_unit=kmh&timezone=auto&forecast_days=7`;
  const r = await fetch(u);
  if (!r.ok) return null;
  const d = await r.json();
  const cc = d.current ?? {};
  const current = {
    time: Math.floor(new Date(cc.time).getTime() / 1000),
    temp_c: cc.temperature_2m,
    feels_c: cc.apparent_temperature,
    humidity: cc.relative_humidity_2m,
    wind_kmh: cc.wind_speed_10m ?? 0,
    gust_kmh: cc.wind_gusts_10m ?? 0,
    wind_dir: cc.wind_direction_10m ?? 0,
    clouds: cc.cloud_cover ?? 0,
    precip_mm: cc.precipitation ?? 0,
    code: cc.weather_code ?? 0,
    icon: wmoIcon(cc.weather_code ?? 0),
    desc: wmoDesc(cc.weather_code ?? 0),
  };
  const H = d.hourly ?? {};
  const hourly = (H.time ?? []).slice(0, 48).map((t: string, i: number) => ({
    time: Math.floor(new Date(t).getTime() / 1000),
    temp_c: H.temperature_2m?.[i],
    humidity: H.relative_humidity_2m?.[i],
    wind_kmh: H.wind_speed_10m?.[i] ?? 0,
    gust_kmh: H.wind_gusts_10m?.[i] ?? 0,
    wind_dir: H.wind_direction_10m?.[i] ?? 0,
    precip_mm: H.precipitation?.[i] ?? 0,
    precip_prob: H.precipitation_probability?.[i] ?? 0,
    clouds: H.cloud_cover?.[i] ?? 0,
    code: H.weather_code?.[i] ?? 0,
    icon: wmoIcon(H.weather_code?.[i] ?? 0),
    desc: wmoDesc(H.weather_code?.[i] ?? 0),
  }));
  const D = d.daily ?? {};
  const daily = (D.time ?? []).slice(0, 7).map((t: string, i: number) => ({
    time: Math.floor(new Date(t).getTime() / 1000),
    tmin_c: D.temperature_2m_min?.[i],
    tmax_c: D.temperature_2m_max?.[i],
    humidity: null,
    wind_kmh: D.wind_speed_10m_max?.[i] ?? 0,
    gust_kmh: D.wind_gusts_10m_max?.[i] ?? 0,
    wind_dir: D.wind_direction_10m_dominant?.[i] ?? 0,
    precip_mm: D.precipitation_sum?.[i] ?? 0,
    precip_prob: D.precipitation_probability_max?.[i] ?? 0,
    clouds: 0,
    code: D.weather_code?.[i] ?? 0,
    icon: wmoIcon(D.weather_code?.[i] ?? 0),
    desc: wmoDesc(D.weather_code?.[i] ?? 0),
  }));
  return {
    tz: d.timezone,
    tz_offset: d.utc_offset_seconds ?? 0,
    source: "open-meteo",
    current,
    hourly,
    daily,
  };
}

function wmoDesc(c: number): string {
  if (c === 0) return "clear sky";
  if (c <= 2) return "mainly clear";
  if (c === 3) return "overcast";
  if (c <= 48) return "fog";
  if (c <= 57) return "drizzle";
  if (c <= 67) return "rain";
  if (c <= 77) return "snow";
  if (c <= 82) return "rain showers";
  if (c <= 86) return "snow showers";
  return "thunderstorm";
}
function wmoIcon(c: number): string {
  if (c === 0) return "01d";
  if (c <= 2) return "02d";
  if (c === 3) return "04d";
  if (c <= 48) return "50d";
  if (c <= 57) return "09d";
  if (c <= 67) return "10d";
  if (c <= 77) return "13d";
  if (c <= 82) return "09d";
  if (c <= 86) return "13d";
  return "11d";
}