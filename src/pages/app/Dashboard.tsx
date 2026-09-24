import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { areaUnit, areaValueHa, fmtAreaHa } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight } from "lucide-react";
import { listMissions } from "@/lib/schedule";
import {
  type AnnotationRow, type MissionRow, type ScanRow, missionsReady, tallyFields, weedArea,
} from "@/lib/dashboard/overview";
import { type DerivedLocation, displayLocation } from "@/lib/fields/location";

type Field = {
  id: string;
  name: string;
  area_hectares: number | null;
  boundary: unknown | null;
  boundary_area_hectares: number | null;
  location: string | null;
  derived_location: DerivedLocation | null;
};


// ----------------------------------------------------------------------------
export default function Dashboard() {
  const units = useUnitSystem();
  const [fields, setFields] = useState<Field[]>([]);
  const [flightCounts, setFlightCounts] = useState<Record<string, number>>({});
  const [lastFlight, setLastFlight] = useState<Record<string, string>>({});
  const [annotations, setAnnotations] = useState<AnnotationRow[] | null>(null);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [missions, setMissions] = useState<MissionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const f = await supabase
      .from("fields")
      .select("id, name, area_hectares, boundary, boundary_area_hectares, location, derived_location")
      .order("created_at", { ascending: false });
    if (f.error) {
      // A failed load is not an empty account.
      setLoadFailed(f.error.message);
      setLoading(false);
      return;
    }
    setLoadFailed(null);
    const list = (f.data as unknown as Field[]) ?? [];
    setFields(list);

    // Pull flight logs so each field row can show "Flights logged" / last flown
    const logs = await supabase
      .from("flight_logs")
      .select("field_id, date_flown")
      .order("date_flown", { ascending: false });
    const counts: Record<string, number> = {};
    const last: Record<string, string> = {};
    ((logs.data as { field_id: string; date_flown: string }[]) ?? []).forEach(l => {
      counts[l.field_id] = (counts[l.field_id] ?? 0) + 1;
      if (!last[l.field_id]) last[l.field_id] = l.date_flown;
    });
    setFlightCounts(counts);
    setLastFlight(last);

    // Saved weed findings, and the scans they belong to, so the newest review
    // of each field is the one that counts. Null on failure and never an empty
    // array: an empty array reads as "looked and found nothing", which a failed
    // request has not earned the right to say.
    const [anns, tasks] = await Promise.all([
      supabase.from("user_annotations")
        .select("id, field_id, task_id, name, issue_type, weed_label, weed_catalog_id, area_hectares, created_at"),
      supabase.from("odm_tasks").select("id, field_id, created_at"),
    ]);
    setAnnotations(anns.error ? null : ((anns.data as unknown as AnnotationRow[]) ?? []));
    setScans(tasks.error ? [] : ((tasks.data as unknown as ScanRow[]) ?? []));

    // A wide window, because the card counts what is still outstanding and a
    // mission booked months out is still outstanding.
    const from = new Date(); from.setFullYear(from.getFullYear() - 1);
    const to = new Date(); to.setFullYear(to.getFullYear() + 2);
    try {
      setMissions(await listMissions(from.toISOString(), to.toISOString()));
    } catch {
      setMissions(null);
    }

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // This is the screen people come back to after doing the work somewhere else,
  // so it re-reads when the tab regains focus rather than showing whatever
  // happened to be true when it first mounted.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const realArea = (f: Field) => Number(f.boundary_area_hectares ?? f.area_hectares ?? 0);
  const tally = useMemo(() => tallyFields(fields), [fields]);
  const weeds = useMemo(
    () => (annotations ? weedArea(annotations, scans) : null),
    [annotations, scans],
  );
  const ready = useMemo(() => (missions ? missionsReady(missions) : null), [missions]);
  const totalFlights = useMemo(
    () => Object.values(flightCounts).reduce((a, n) => a + n, 0),
    [flightCounts],
  );

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Operations Dashboard</h1>
          <p className="text-muted-foreground text-sm">A snapshot of your fields and scans.</p>
        </div>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total fields" to="/app/fields"
          value={loading ? null : String(tally.total)}
          sub={loading ? "Loading"
            : `${tally.mapped} mapped, ${tally.awaiting} awaiting boundaries`} />

        {/* Ground the operator's own review found weeds on, counted once per
            field. NOT the treated area: the planner clips zones to the boundary
            and insets a headland before it prices anything, and it recomputes
            rather than trusting the stored figure. Both are right for their own
            question and they are not the same number. */}
        <Stat label="Weed-affected area" to="/app/fields"
          value={loading ? null
            : !weeds || weeds.hectares === null ? "-"
            : areaValueHa(weeds.hectares, units).toFixed(1)}
          unit={!loading && weeds && weeds.hectares !== null ? areaUnit(units) : undefined}
          sub={loading ? "Loading"
            : !weeds ? "Could not read your scan results"
            : weeds.hectares === null ? "No scans reviewed yet"
            : `${weeds.zones} zone${weeds.zones === 1 ? "" : "s"} across `
              + `${weeds.fields} field${weeds.fields === 1 ? "" : "s"}, latest scan each`} />

        <Stat label="Missions ready" to="/app/schedule"
          value={loading ? null : ready === null ? "-" : String(ready)}
          sub={loading ? "Loading"
            : ready === null ? "Could not read your schedule"
            : ready === 0 ? "Plan a treatment and schedule it to see it here"
            : "Planned and scheduled, not yet flown"} />

        <Stat label="Spray logs" to="/app/fields"
          value={loading ? null : String(totalFlights)}
          sub={loading ? "Loading" : "Applications recorded across all fields"} />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Field list */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Fields</h2>
            <Link to="/app/fields" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
              Manage <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : loadFailed ? (
            <p className="text-sm text-destructive">
              Couldn&rsquo;t load your fields ({loadFailed}). This is a loading failure, not an
              empty account. Check your connection and reload.
            </p>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields yet. <Link to="/app/fields" className="underline">Create your first field</Link>.</p>
          ) : (
            <ul className="divide-y divide-border">
              {fields.map(f => {
                const defined = !!f.boundary;
                const area = realArea(f);
                const flown = flightCounts[f.id] ?? 0;
                const lastDate = lastFlight[f.id];
                return (
                  <li key={f.id}>
                    <Link to={`/app/fields/${f.id}`} className="flex items-center gap-3 py-3 hover:bg-muted/30 rounded-md px-2 -mx-2 transition-colors">
                      <span className={`h-2.5 w-2.5 rounded-full ${defined ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-sm">{f.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {area ? fmtAreaHa(area, units).text : "-"}
                          {defined && <span className="ml-2 text-emerald-500">(measured)</span>}
                          {/* Read, never fetched. The geocoder is asked in one
                              place in the app, on the Fields page. */}
                          {displayLocation(f) && <span className="ml-2">· {displayLocation(f)}</span>}
                        </div>
                      </div>
                      <div className="text-right text-xs tabular-nums">
                        <div className={flown > 0 ? "text-foreground" : "text-muted-foreground"}>
                          {flown} {flown === 1 ? "flight" : "flights"} logged
                        </div>
                        {lastDate && (
                          <div className="text-[10px] text-muted-foreground">last {lastDate}</div>
                        )}
                      </div>
                      <Badge variant="outline" className={defined ? "border-emerald-500 text-emerald-500" : "text-muted-foreground"}>
                        {defined ? "Boundary set" : "Not defined"}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}


/**
 * One headline figure and one line under it.
 *
 * These were four hand-written blocks, which is how they came to have four
 * different subtitle voices. A dash is the empty state and it serves both
 * "nothing found" and "could not read", with the subtitle carrying the
 * difference: a zero in this position would be a claim, and neither case has
 * earned the right to make one.
 */
function Stat({ label, value, unit, sub, to }: {
  label: string;
  value: string | null;
  unit?: string;
  sub: string;
  to: string;
}) {
  return (
    <Link to={to} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="p-5 h-full transition-colors hover:bg-muted/30">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-display text-4xl mt-1 tabular-nums">
          {value === null
            ? <span className="inline-block h-9 w-12 rounded bg-muted animate-pulse align-bottom" />
            : value}
          {unit && <span className="text-base text-muted-foreground ml-1">{unit}</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </Card>
    </Link>
  );
}
