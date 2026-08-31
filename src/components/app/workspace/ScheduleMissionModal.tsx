// Schedule a generated flight plan onto the calendar.
//
// The drone picker re-estimates as you change it. That re-estimation runs
// through computeMissionStats — the SAME function the planner uses for its live
// numbers — so what gets frozen into the calendar is what the planner was
// showing. It never mutates the flight plan: backing out of this dialog leaves
// the planner exactly as it was.
import { useEffect, useMemo, useState } from "react";
import { Battery, Clock, Droplets, Loader2, Wind, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { type DroneSpec, resolveDroneSpec } from "@/lib/droneSpecs";
import type { Mission } from "@/lib/mission";
import type { LatLng2 } from "@/lib/geo";
import {
  type MissionWx, computeMissionStats, conditionsAt,
} from "@/lib/missionStats";
import { type ScheduledStats, saveMission } from "@/lib/schedule";
import { readCachedWeather } from "@/lib/weather";
import { fmtAreaHa, fmtTemp, fmtVolume, fmtWindSpeed } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

/**
 * A fleet row as the planner and this dialog need it.
 *
 * `specs` is load-bearing, not decoration: a custom aircraft keeps its tank and
 * swath there, so a dialog that selects a drone without carrying its specs
 * estimates a custom airframe against the generic fallback shape instead of
 * the machine the operator described.
 */
export type FleetDrone = {
  id: string; name: string; model: string; battery: number; specs?: unknown;
};

/** Local datetime for an <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ScheduleMissionModal({
  open, onOpenChange, mission, zones, drones, fallbackSpec, sprayAltM, transitAltM,
  tankLoadPct, fieldId, scanId, flightPlanId, center, fieldName, initialDroneId, onScheduled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mission: Mission | null;
  /** Marked zones only — area and the rate each is treated at. */
  zones: { areaM2: number; rateLha: number }[];
  drones: FleetDrone[];
  /** Used when no fleet drone is selected, so estimates still appear. */
  fallbackSpec: DroneSpec;
  sprayAltM: number;
  transitAltM: number;
  tankLoadPct: number;
  fieldId: string | null;
  scanId: string | null;
  flightPlanId: string | null;
  center: LatLng2;
  fieldName: string;
  initialDroneId: string | null;
  onScheduled: () => void;
}) {
  const units = useUnitSystem();
  const [when, setWhen] = useState(() => {
    // Tomorrow morning: a spray job scheduled for "now" is not a schedule.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return toLocalInput(d);
  });
  const [droneId, setDroneId] = useState<string | null>(initialDroneId);
  const [label, setLabel] = useState(fieldName);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setDroneId(initialDroneId); }, [open, initialDroneId]);
  useEffect(() => { if (open) setLabel(fieldName); }, [open, fieldName]);

  const scheduledAt = useMemo(() => new Date(when), [when]);

  // The selected drone's real specs drive the estimate, exactly as they do
  // anywhere else the app computes endurance.
  const spec: DroneSpec = useMemo(() => {
    const d = drones.find(x => x.id === droneId);
    if (!d) return fallbackSpec;
    // The drone's OWN specs, not a field-level custom profile: two custom
    // aircraft in one fleet are two different aircraft.
    return resolveDroneSpec(d.model, (d.specs as never) ?? null).spec;
  }, [droneId, drones, fallbackSpec]);

  const cached = useMemo(
    () => (open ? readCachedWeather(center.lat, center.lng) : null),
    [open, center.lat, center.lng],
  );

  const wx: MissionWx | null = useMemo(() => {
    const cur = cached?.data?.current;
    if (!cur) return null;
    return {
      wind_ms: (cur.wind_kmh ?? 0) / 3.6,
      wind_dir: cur.wind_dir ?? 0,
      temp_c: cur.temp_c ?? 20,
    };
  }, [cached]);

  const conditions = useMemo(
    () => conditionsAt(cached?.data ?? null, scheduledAt, {
      windText: (ms) => fmtWindSpeed(ms, units).text,
      tempText: (c) => fmtTemp(c, units).text,
    }),
    [cached, scheduledAt, units],
  );

  const stats = useMemo(() => {
    const s = computeMissionStats({
      mission, spec, sprayAltM, transitAltM, tankLoadPct, zones, wx,
    });
    return { ...s, flightConditions: conditions };
  }, [mission, spec, sprayAltM, transitAltM, tankLoadPct, zones, wx, conditions]);

  const save = async () => {
    if (!Number.isFinite(scheduledAt.getTime())) {
      toast.error("Pick a valid date and time.");
      return;
    }
    setSaving(true);
    try {
      const snapshot: ScheduledStats = {
        batteriesNeeded: stats.batteriesNeeded,
        flightTimeMinutes: stats.flightTimeMinutes,
        pesticideAmountLiters: stats.pesticideAmountLiters,
        treatedAreaHa: stats.treatedAreaHa,
        flightConditions: stats.flightConditions,
      };
      const { snapshotStored } = await saveMission({
        fieldId, scanId, flightPlanId,
        scheduledAt: scheduledAt.toISOString(),
        location: { lat: center.lat, lng: center.lng, label: label.trim() || undefined },
        droneId,
        chemical: null,
        notes: notes.trim() || null,
        stats: snapshot,
      });
      toast.success(
        snapshotStored
          ? "Mission scheduled"
          : "Mission scheduled, estimates not stored (run the pending migration)",
      );
      onOpenChange(false);
      onScheduled();
    } catch (e) {
      toast.error("Couldn't schedule the mission", {
        description: `Nothing was scheduled. Check your connection and try again. (${String((e as Error)?.message ?? e)})`,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-sm text-neutral-200";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Schedule this mission</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Date &amp; time</label>
            <input type="datetime-local" className={inputCls} value={when}
              onChange={e => setWhen(e.target.value)} />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Location</label>
            <input className={inputCls} value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Field name or access point" />
            <div className="text-[10px] text-neutral-600 mt-1 font-mono">
              {center.lat.toFixed(5)}, {center.lng.toFixed(5)}, from the field boundary
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Drone</label>
            <select className={inputCls} value={droneId ?? ""}
              onChange={e => setDroneId(e.target.value || null)}>
              <option value="">No drone assigned</option>
              {drones.map(d => (
                <option key={d.id} value={d.id}>{d.name || d.model}, {d.model}</option>
              ))}
            </select>
            <div className="text-[10px] text-neutral-600 mt-1">
              Estimates below follow the selected aircraft.
            </div>
          </div>

          {/* Live estimate — the same numbers that get frozen on save. */}
          <div className="rounded-sm border border-[#222] p-3 space-y-2" style={{ background: "#0f0f0f" }}>
            <Row icon={Battery} label="Batteries to bring" value={`${stats.batteriesNeeded}`} />
            <Row icon={Clock} label="Flight time" value={`${stats.flightTimeMinutes.toFixed(1)} min`} />
            <Row icon={Droplets} label="Chemical"
              value={`${fmtVolume(stats.pesticideAmountLiters, units).text} over ${fmtAreaHa(stats.treatedAreaHa, units).text}`} />
            <Row icon={Wind} label="Conditions" value={conditions.summary}
              warn={!conditions.available} />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Notes</label>
            <textarea className={`${inputCls} h-16 resize-none`} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <DialogFooter>
          <button onClick={() => onOpenChange(false)}
            className="text-xs px-3 py-2 rounded-sm border border-[#222] text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="text-xs px-3 py-2 rounded-sm bg-[#4CAF50] hover:bg-[#43a047] text-black font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save to schedule"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ icon: Icon, label, value, warn }: {
  icon: LucideIcon; label: string; value: string; warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${warn ? "text-yellow-500" : "text-[#4CAF50]"}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
        <div className={`text-xs ${warn ? "text-yellow-500" : "text-neutral-200"}`}>{value}</div>
      </div>
    </div>
  );
}

export default ScheduleMissionModal;
