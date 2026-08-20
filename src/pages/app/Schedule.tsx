// Schedule — a month calendar of upcoming spray missions.
//
// Reads the `jobs` table via lib/schedule.ts. Everything a card shows is the
// SNAPSHOT frozen when the mission was scheduled, never a recomputation: the
// question this page answers is "what did we commit to?", and that answer must
// not move because the field was edited afterwards.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Battery, Calendar as CalendarIcon, ChevronLeft, ChevronRight,
  Clock, Droplets, Loader2, MapPin, Plane, Trash2, Wind, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  type ScheduledMission, dayKey, deleteMission, groupByDay, listMissions,
  monthGrid, monthRangeISO,
} from "@/lib/schedule";
import { fmtAreaHa, fmtVolume } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Schedule() {
  const units = useUnitSystem();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [missions, setMissions] = useState<ScheduledMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ScheduledMission | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [drones, setDrones] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { fromISO, toISO } = monthRangeISO(year, month);
      const rows = await listMissions(fromISO, toISO);
      setMissions(rows);
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { void load(); }, [load]);

  // Field and drone names, so a card can say "North Ridge" rather than a uuid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [f, d] = await Promise.all([
        supabase.from("fields").select("id, name"),
        supabase.from("drones").select("id, name, model"),
      ]);
      if (cancelled) return;
      const fm: Record<string, string> = {};
      for (const r of (f.data ?? []) as { id: string; name: string }[]) fm[r.id] = r.name;
      const dm: Record<string, string> = {};
      for (const r of (d.data ?? []) as { id: string; name: string; model: string }[]) {
        dm[r.id] = r.name || r.model;
      }
      setNames(fm);
      setDrones(dm);
    })();
    return () => { cancelled = true; };
  }, []);

  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const byDay = useMemo(() => groupByDay(missions), [missions]);
  const todayKey = dayKey(today);

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const remove = async (m: ScheduledMission) => {
    if (!window.confirm(`Cancel the mission scheduled for ${new Date(m.scheduledAt).toLocaleString()}?`)) return;
    try {
      await deleteMission(m.id);
      setOpen(null);
      toast.success("Mission cancelled");
      void load();
    } catch (e) {
      toast.error(`Could not cancel: ${(e as Error)?.message ?? e}`);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-1">
        <CalendarIcon className="h-5 w-5 text-[#4CAF50]" />
        <h1 className="font-display text-2xl">Schedule</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Upcoming spray missions. Each entry keeps the estimates as they stood when it was
        scheduled — editing a field later will not rewrite what you committed to.
      </p>

      <Card className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => step(-1)} aria-label="Previous month"
            className="h-8 w-8 grid place-items-center rounded-sm border border-border hover:bg-muted transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg">{MONTHS[month]}</span>
            <span className="text-muted-foreground tabular-nums">{year}</span>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
          </div>
          <button onClick={() => step(1)} aria-label="Next month"
            className="h-8 w-8 grid place-items-center rounded-sm border border-border hover:bg-muted transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-sm border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-400">
            Could not load the schedule: {error}
          </div>
        )}

        <div className="grid grid-cols-7 gap-px text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          {DOW.map(d => <div key={d} className="px-2 py-1">{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-px bg-border rounded-sm overflow-hidden">
          {grid.map((d, i) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const otherMonth = d.getMonth() !== month;
            return (
              <div key={i}
                className={`min-h-[92px] p-1.5 bg-card ${otherMonth ? "opacity-40" : ""}`}>
                <div className={`text-[11px] tabular-nums mb-1 ${
                  k === todayKey
                    ? "text-[#4CAF50] font-semibold"
                    : "text-muted-foreground"}`}>
                  {d.getDate()}
                </div>
                {/* Several missions on one day stack rather than overwrite. */}
                <div className="flex flex-col gap-1">
                  {list.map(m => (
                    <button key={m.id} onClick={() => setOpen(m)}
                      className="w-full text-left rounded-sm border border-[#4CAF50]/40 bg-[#4CAF50]/10 hover:bg-[#4CAF50]/20 px-1.5 py-1 transition-colors">
                      <div className="text-[10px] font-mono text-[#4CAF50] tabular-nums">
                        {new Date(m.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </div>
                      <div className="text-[11px] truncate">
                        {m.location?.label || (m.fieldId ? names[m.fieldId] : null) || "Mission"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {!loading && missions.length === 0 && !error && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Nothing scheduled this month. Generate a flight plan in a field&rsquo;s Flight Planner
            and press <span className="text-foreground">Schedule</span>.
          </div>
        )}
      </Card>

      <Dialog open={!!open} onOpenChange={o => !o && setOpen(null)}>
        <DialogContent className="max-w-lg">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-[#4CAF50]" />
                  {open.location?.label || (open.fieldId ? names[open.fieldId] : null) || "Scheduled mission"}
                </DialogTitle>
              </DialogHeader>

              <div className="text-sm space-y-3">
                <Meta icon={Clock} label="When"
                  value={new Date(open.scheduledAt).toLocaleString([], {
                    weekday: "short", year: "numeric", month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })} />
                <Meta icon={Plane} label="Drone"
                  value={open.droneId ? (drones[open.droneId] ?? open.droneId) : "Not assigned"} />
                <Meta icon={MapPin} label="Location"
                  value={open.location
                    ? `${open.location.label ? `${open.location.label} · ` : ""}${open.location.lat.toFixed(5)}, ${open.location.lng.toFixed(5)}`
                    : "From field boundary"} />

                <div className="border-t border-border pt-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    Estimates at scheduling time
                  </div>
                  {!open.stats ? (
                    <div className="rounded-sm border border-yellow-900/50 bg-yellow-950/20 p-3 text-xs text-yellow-500 flex gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>
                        No snapshot stored for this mission. It was scheduled before the
                        snapshot columns existed — the date, field and drone are correct,
                        but the estimates were not captured.
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Stat icon={Battery} label="Batteries to bring"
                        value={`${open.stats.batteriesNeeded}`} />
                      <Stat icon={Clock} label="Flight time"
                        value={`${open.stats.flightTimeMinutes.toFixed(1)} min`} />
                      <Stat icon={Droplets} label="Chemical"
                        value={`${fmtVolume(open.stats.pesticideAmountLiters, units).text} over ${fmtAreaHa(open.stats.treatedAreaHa, units).text}`} />
                      <Stat icon={Wind} label="Flight conditions"
                        value={open.stats.flightConditions.summary}
                        warn={!open.stats.flightConditions.available} />
                    </div>
                  )}
                </div>

                {open.notes && (
                  <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                    {open.notes}
                  </div>
                )}

                <div className="border-t border-border pt-3 flex items-center justify-between">
                  {open.fieldId ? (
                    <Link to={`/app/fields/${open.fieldId}`}
                      className="text-xs text-[#4CAF50] hover:underline">
                      Open the field →
                    </Link>
                  ) : <span />}
                  <button onClick={() => remove(open)}
                    className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Cancel mission
                  </button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate">{value}</div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, warn }: {
  icon: LucideIcon; label: string; value: string; warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${warn ? "text-yellow-500" : "text-[#4CAF50]"}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-sm ${warn ? "text-yellow-500" : ""}`}>{value}</div>
      </div>
    </div>
  );
}
