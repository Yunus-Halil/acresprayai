import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Plane, Battery, Wifi, Signal, Gauge, Thermometer, Wind, Radio,
  Clock, MapPin, Wrench, AlertTriangle, CheckCircle2, Droplets,
  Cpu, HardDrive, Satellite, Activity, Zap, Compass,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ScatterChart, Scatter, ZAxis,
} from "recharts";

// ---------- mock data ----------
const FLEET = [
  {
    id: "AGV-01", model: "DJI Mavic 3M", role: "Scanner", status: "in_flight",
    battery: 64, signal: 92, health: 97, temp: 38, alt_m: 92, speed_ms: 14.2,
    wind_ms: 4.8, gps_sats: 18, link_km: 3.2, payload_kg: 0.92, hours: 412,
    cycles: 318, firmware: "v04.02.11", last_service: "2026-05-04", next_service_h: 88,
    location: "B-04 North", sd_used: 64, cpu: 41,
  },
  {
    id: "AGV-02", model: "DJI Agras T30", role: "Sprayer", status: "charging",
    battery: 38, signal: 100, health: 88, temp: 31, alt_m: 0, speed_ms: 0,
    wind_ms: 0, gps_sats: 22, link_km: 0, payload_kg: 0, hours: 904,
    cycles: 1212, firmware: "v07.11.03", last_service: "2026-04-21", next_service_h: 12,
    location: "Hangar A", sd_used: 22, cpu: 8,
  },
  {
    id: "AGV-03", model: "DJI Mavic 3M", role: "Scanner", status: "idle",
    battery: 98, signal: 100, health: 99, temp: 24, alt_m: 0, speed_ms: 0,
    wind_ms: 0, gps_sats: 20, link_km: 0, payload_kg: 0, hours: 88,
    cycles: 64, firmware: "v04.02.11", last_service: "2026-06-01", next_service_h: 412,
    location: "Hangar A", sd_used: 12, cpu: 4,
  },
  {
    id: "AGV-04", model: "DJI Agras T40", role: "Sprayer", status: "in_flight",
    battery: 71, signal: 88, health: 94, temp: 42, alt_m: 18, speed_ms: 9.8,
    wind_ms: 6.1, gps_sats: 17, link_km: 1.1, payload_kg: 38.4, hours: 612,
    cycles: 821, firmware: "v07.11.03", last_service: "2026-05-19", next_service_h: 188,
    location: "B-04 North", sd_used: 41, cpu: 62,
  },
  {
    id: "AGV-05", model: "Parrot Anafi USA", role: "Scanner", status: "in_flight",
    battery: 52, signal: 78, health: 91, temp: 36, alt_m: 124, speed_ms: 12.4,
    wind_ms: 5.4, gps_sats: 16, link_km: 4.6, payload_kg: 0.46, hours: 248,
    cycles: 198, firmware: "v01.08.02", last_service: "2026-05-12", next_service_h: 152,
    location: "C-11 South", sd_used: 71, cpu: 38,
  },
  {
    id: "AGV-06", model: "XAG P100", role: "Sprayer", status: "maintenance",
    battery: 0, signal: 0, health: 62, temp: 22, alt_m: 0, speed_ms: 0,
    wind_ms: 0, gps_sats: 0, link_km: 0, payload_kg: 0, hours: 1488,
    cycles: 2104, firmware: "v03.04.10", last_service: "2026-06-10", next_service_h: 0,
    location: "Service Bay", sd_used: 4, cpu: 0,
  },
];

const TELEMETRY_24H = Array.from({ length: 48 }, (_, i) => {
  const t = i / 2;
  return {
    t: `${String(Math.floor(t)).padStart(2, "0")}:${t % 1 ? "30" : "00"}`,
    battery_avg: 60 + 20 * Math.sin(i / 6) + (Math.random() - 0.5) * 6,
    signal_avg: 82 + 10 * Math.cos(i / 5) + (Math.random() - 0.5) * 4,
    altitude_avg: 40 + 35 * Math.abs(Math.sin(i / 7)) + (Math.random() - 0.5) * 8,
  };
});

const LINK_QUALITY = Array.from({ length: 30 }, (_, i) => {
  const distance = (i + 1) * 0.18;
  return {
    distance,
    AGV01: Math.max(0, 100 - Math.pow(distance / 3.5, 1.7) * 100 + (Math.random() - 0.5) * 6),
    AGV04: Math.max(0, 100 - Math.pow(distance / 1.6, 1.6) * 100 + (Math.random() - 0.5) * 6),
    AGV05: Math.max(0, 100 - Math.pow(distance / 5.0, 1.5) * 100 + (Math.random() - 0.5) * 6),
  };
});

const WEEK_HOURS = [
  { day: "Mon", scan: 6.4, spray: 3.1 },
  { day: "Tue", scan: 4.8, spray: 5.2 },
  { day: "Wed", scan: 7.2, spray: 2.0 },
  { day: "Thu", scan: 5.6, spray: 4.4 },
  { day: "Fri", scan: 8.1, spray: 6.8 },
  { day: "Sat", scan: 3.2, spray: 1.4 },
  { day: "Sun", scan: 1.8, spray: 0.6 },
];

const RADAR_PROFILE = [
  { metric: "Range", AGV01: 88, AGV04: 72, AGV05: 96 },
  { metric: "Speed", AGV01: 78, AGV04: 64, AGV05: 82 },
  { metric: "Payload", AGV01: 22, AGV04: 98, AGV05: 18 },
  { metric: "Endurance", AGV01: 84, AGV04: 58, AGV05: 78 },
  { metric: "Wind tol.", AGV01: 72, AGV04: 88, AGV05: 68 },
  { metric: "Optics", AGV01: 96, AGV04: 60, AGV05: 92 },
];

const SCATTER = FLEET.filter(d => d.status === "in_flight").map(d => ({
  link: d.link_km, signal: d.signal, alt: d.alt_m, name: d.id,
}));

const ALERTS = [
  { sev: "high",   id: "AGV-06", text: "Rotor 3 vibration above 4.2g — grounded for service" },
  { sev: "med",    id: "AGV-02", text: "Battery cycle count 1212 — replace pack within 30 days" },
  { sev: "med",    id: "AGV-05", text: "GPS satellites dropped to 16 over canyon edge" },
  { sev: "low",    id: "AGV-04", text: "Spray nozzle 7 flow rate -8% vs baseline" },
  { sev: "low",    id: "AGV-01", text: "Firmware v04.02.13 available — improved obstacle avoidance" },
];

// ---------- helpers ----------
const statusTone = (s: string) =>
  s === "in_flight" ? "border-sky-500 text-sky-500" :
  s === "charging"  ? "border-amber-500 text-amber-600" :
  s === "maintenance" ? "border-destructive text-destructive" :
  "border-emerald-500 text-emerald-600";

const sevTone = (s: string) =>
  s === "high" ? "bg-destructive/15 text-destructive border-destructive/30" :
  s === "med"  ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
  "bg-sky-500/10 text-sky-600 border-sky-500/30";

const Stat = ({ label, value, unit, tone }: { label: string; value: string | number; unit?: string; tone?: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`font-display text-base ${tone ?? ""}`}>{value}<span className="text-xs text-muted-foreground font-sans ml-0.5">{unit}</span></div>
  </div>
);

// ---------- main ----------
export default function FleetIntel() {
  const active = FLEET.filter(d => d.status === "in_flight").length;
  const totalHours = FLEET.reduce((a, d) => a + d.hours, 0);
  const fleetHealth = Math.round(FLEET.reduce((a, d) => a + d.health, 0) / FLEET.length);
  const fleetBattery = Math.round(FLEET.filter(d => d.status !== "maintenance").reduce((a, d) => a + d.battery, 0) / Math.max(1, FLEET.filter(d => d.status !== "maintenance").length));

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Plane className="h-3 w-3" /> Active</div>
          <div className="font-display text-2xl text-sky-500">{active}<span className="text-sm text-muted-foreground font-sans">/{FLEET.length}</span></div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> Fleet health</div>
          <div className="font-display text-2xl text-emerald-500">{fleetHealth}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Battery className="h-3 w-3" /> Avg battery</div>
          <div className="font-display text-2xl">{fleetBattery}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Total hours</div>
          <div className="font-display text-2xl">{totalHours.toLocaleString()}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Droplets className="h-3 w-3" /> Spray today</div>
          <div className="font-display text-2xl">412<span className="text-sm text-muted-foreground font-sans"> L</span></div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Alerts</div>
          <div className="font-display text-2xl text-amber-500">{ALERTS.length}</div>
        </Card>
      </div>

      {/* Fleet roster + telemetry */}
      <div className="grid xl:grid-cols-[1.4fr_1fr] gap-6">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Live roster</div>
              <div className="font-display text-lg">All drones · real-time telemetry</div>
            </div>
            <Badge variant="outline" className="gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> 2s refresh</Badge>
          </div>

          <div className="space-y-2">
            {FLEET.map(d => (
              <div key={d.id} className="rounded-lg border bg-card/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Plane className="h-4 w-4 text-primary" />
                    <div className="font-medium">{d.id}</div>
                    <span className="text-xs text-muted-foreground truncate">· {d.model} · {d.role}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {d.location}</span>
                    <Badge variant="outline" className={statusTone(d.status)}>{d.status.replace("_", " ")}</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-4 md:grid-cols-8 gap-3 items-end">
                  <Stat label="Battery" value={d.battery} unit="%" tone={d.battery < 25 ? "text-destructive" : d.battery < 50 ? "text-amber-500" : "text-emerald-500"} />
                  <Stat label="Wi-Fi"   value={d.signal} unit="%" tone={d.signal < 30 ? "text-destructive" : ""} />
                  <Stat label="Link"    value={d.link_km.toFixed(1)} unit="km" />
                  <Stat label="Alt"     value={d.alt_m} unit="m" />
                  <Stat label="Speed"   value={d.speed_ms.toFixed(1)} unit="m/s" />
                  <Stat label="Sats"    value={d.gps_sats} />
                  <Stat label="Temp"    value={d.temp} unit="°C" tone={d.temp > 40 ? "text-amber-500" : ""} />
                  <Stat label="Health"  value={d.health} unit="%" tone={d.health < 70 ? "text-destructive" : ""} />
                </div>

                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Battery</span><span>{d.battery}%</span></div>
                    <Progress value={d.battery} className="h-1.5" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>SD storage</span><span>{d.sd_used}%</span></div>
                    <Progress value={d.sd_used} className="h-1.5" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>CPU load</span><span>{d.cpu}%</span></div>
                    <Progress value={d.cpu} className="h-1.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Right column: alerts + radar */}
        <div className="space-y-6">
          <Card className="p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Maintenance & alerts
            </div>
            <div className="space-y-2">
              {ALERTS.map((a, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-md border p-2 text-xs ${sevTone(a.sev)}`}>
                  <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{a.sev}</Badge>
                  <div><span className="font-medium">{a.id}</span> · {a.text}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Platform capability profile</div>
            <div className="text-xs text-muted-foreground mb-3">Normalized 0–100 across in-flight units</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={RADAR_PROFILE}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} stroke="hsl(var(--border))" />
                  <Radar name="AGV-01" dataKey="AGV01" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} />
                  <Radar name="AGV-04" dataKey="AGV04" stroke="hsl(var(--accent))" fill="hsl(var(--accent))" fillOpacity={0.25} />
                  <Radar name="AGV-05" dataKey="AGV05" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.18} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-3 justify-center text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />AGV-01</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" />AGV-04</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />AGV-05</span>
            </div>
          </Card>
        </div>
      </div>

      {/* Wi-Fi / link distance + 24h telemetry */}
      <div className="grid xl:grid-cols-2 gap-6">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Wifi className="h-3 w-3" /> Link quality vs distance</div>
            <Badge variant="outline" className="text-[10px]">2.4 / 5.8 GHz · OcuSync 3+</Badge>
          </div>
          <div className="text-xs text-muted-foreground mb-3">Signal % as drones move outbound from the ground station</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={LINK_QUALITY} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="distance" tickFormatter={v => `${v.toFixed(1)}km`} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} labelFormatter={v => `${Number(v).toFixed(2)} km from base`} />
                <Line type="monotone" dataKey="AGV01" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="AGV-01 (Mavic 3M)" />
                <Line type="monotone" dataKey="AGV04" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="AGV-04 (Agras T40)" />
                <Line type="monotone" dataKey="AGV05" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="AGV-05 (Anafi USA)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div className="rounded-md border p-2"><div className="text-muted-foreground">AGV-01 max safe</div><div className="font-display">3.2 km</div></div>
            <div className="rounded-md border p-2"><div className="text-muted-foreground">AGV-04 max safe</div><div className="font-display">1.4 km</div></div>
            <div className="rounded-md border p-2"><div className="text-muted-foreground">AGV-05 max safe</div><div className="font-display">4.6 km</div></div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><Activity className="h-3 w-3" /> 24-hour fleet telemetry</div>
          <div className="text-xs text-muted-foreground mb-3">Rolling averages across all in-flight drones</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={TELEMETRY_24H} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="bat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="sig" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="t" interval={5} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                <Area type="monotone" dataKey="battery_avg" stroke="hsl(var(--primary))" fill="url(#bat)" name="Battery %" />
                <Area type="monotone" dataKey="signal_avg" stroke="hsl(var(--accent))" fill="url(#sig)" name="Signal %" />
                <Line type="monotone" dataKey="altitude_avg" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" dot={false} name="Altitude m" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Utilization + scatter */}
      <div className="grid xl:grid-cols-2 gap-6">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><Clock className="h-3 w-3" /> Weekly flight hours</div>
          <div className="text-xs text-muted-foreground mb-3">Scan vs spray utilization</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={WEEK_HOURS} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                <Bar dataKey="scan" stackId="a" fill="hsl(var(--primary))" name="Scan h" radius={[0, 0, 0, 0]} />
                <Bar dataKey="spray" stackId="a" fill="hsl(var(--accent))" name="Spray h" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><Satellite className="h-3 w-3" /> Signal vs link distance · in-flight</div>
          <div className="text-xs text-muted-foreground mb-3">Bubble size = altitude (m)</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="link" name="Link" unit="km" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="number" dataKey="signal" name="Signal" unit="%" domain={[0, 100]} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <ZAxis type="number" dataKey="alt" range={[60, 400]} name="Altitude" unit="m" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                <Scatter data={SCATTER} fill="hsl(var(--primary))" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Maintenance & firmware table */}
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1"><Wrench className="h-3 w-3" /> Maintenance ledger</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 font-medium">Drone</th>
                <th className="text-left font-medium">Model</th>
                <th className="text-right font-medium">Hours</th>
                <th className="text-right font-medium">Cycles</th>
                <th className="text-left font-medium">Firmware</th>
                <th className="text-left font-medium">Last service</th>
                <th className="text-right font-medium">Next in</th>
                <th className="text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {FLEET.map(d => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 font-medium">{d.id}</td>
                  <td className="text-muted-foreground">{d.model}</td>
                  <td className="text-right">{d.hours}</td>
                  <td className="text-right">{d.cycles}</td>
                  <td className="font-mono text-xs">{d.firmware}</td>
                  <td className="text-muted-foreground">{d.last_service}</td>
                  <td className={`text-right ${d.next_service_h <= 24 ? "text-destructive" : d.next_service_h < 100 ? "text-amber-500" : ""}`}>
                    {d.next_service_h === 0 ? "now" : `${d.next_service_h}h`}
                  </td>
                  <td className="text-center">
                    {d.next_service_h === 0
                      ? <Badge variant="outline" className="border-destructive text-destructive">Service</Badge>
                      : d.next_service_h < 100
                      ? <Badge variant="outline" className="border-amber-500 text-amber-600">Due soon</Badge>
                      : <Badge variant="outline" className="border-emerald-500 text-emerald-600">OK</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">
        Demo telemetry · simulated for illustration. Connect a DJI FlightHub 2, Parrot Open Flight or XAG OneAPI bridge to stream live data.
      </p>
    </div>
  );
}