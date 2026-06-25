import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

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
      // Fall back to weather 2.5 if 3.0 isn't activated on the account.
      if (r.status === 401 || r.status === 403) {
        return json({ error: "OpenWeather One Call 3.0 not enabled for this API key. Activate it in your OpenWeather account (free 1000 calls/day).", detail: text }, 502);
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
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}