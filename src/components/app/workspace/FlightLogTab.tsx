// Every mission ever logged for this field, in one place.
//
// The flight log was write-only until now: the Log Flight dialog inserted a
// row, the report read back the ONE flight belonging to the open scan, and
// everything else a pilot had recorded was invisible. For a record an operator
// is required to keep, "it is in the database" is not the same as "they can
// look at it" — so this is the reading surface.
//
// READ-ONLY, AND HONEST ABOUT WHAT IS NOT STORED. Every value shown is a value
// somebody logged; nothing is defaulted, averaged or inferred. Where a figure
// was never captured it says so rather than printing a zero, and the
// application record — which `flight_logs` still has no column for — is shown
// only for the flight whose record survives on the field's settings snapshot,
// with the gap named for the rest.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, CalendarDays, FileText, Loader2, MapPin, Plane, Sprout,
} from "lucide-react";
import { type ApplicationRecord, conditionSourceLabel } from "@/lib/reportRecord";
import { toast } from "sonner";
import { acreageFromBuggyPath, LEGACY_AREA_NOTE } from "@/lib/legacyAreaAudit";
import type { FarmerSettings } from "@/lib/farmerSettings";
import { fmtAreaAc, fmtVolume } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

export type FlightLogRow = {
  id: string;
  field_id: string | null;
  scan_id: string | null;
  drone_id: string | null;
  date_flown: string;
  battery_start: number | null;
  battery_end: number | null;
  tank_refills: number | null;
  zones_completed: string[] | null;
  acres_treated: number | null;
  liters_applied: number | null;
  notes: string | null;
  created_at: string | null;
};

type DroneRow = { id: string; name: string; model: string };
type ReportRow = { id: string; flight_log_id: string | null; storage_path: string; generated_at: string };

const longDate = (iso: string) =>
  new Date(iso.length <= 10 ? `${iso}T00:00` : iso).toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "long", day: "numeric",
  });

/** A value nobody recorded is said out loud, never rendered as zero. */
function Value({ children, missing }: { children?: React.ReactNode; missing?: boolean }) {
  if (missing) return <span className="italic text-neutral-600">not recorded</span>;
  return <span className="font-mono text-neutral-200">{children}</span>;
}

function Stat({ label, children, missing }: {
  label: string; children?: React.ReactNode; missing?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-[12px]"><Value missing={missing}>{children}</Value></div>
    </div>
  );
}

function RecordBlock({ record }: { record: ApplicationRecord }) {
  const rows: [string, string | null][] = [
    ["Grower", record.grower_name || null],
    ["Product", record.product_name || null],
    ["EPA reg. no.", record.epa_reg_no || null],
    ["Start", record.start_time],
    ["End", record.end_time],
    // Provenance prints with the value: observed, or model data with its
    // station and distance. Pre-provenance records print bare rather than
    // being stamped with a provenance nobody recorded.
    ["Wind", record.wind_speed_mph != null && record.wind_direction
      ? `${record.wind_speed_mph} mph ${record.wind_direction}`
        + conditionSourceLabel(record.wind_source, record.conditions_source)
      : null],
    ["Temperature", record.temperature_f != null
      ? `${record.temperature_f} °F`
        + conditionSourceLabel(record.temp_source, record.conditions_source)
      : null],
    ["Applicator cert.", record.applicator_cert_no || null],
    ["Part 137 cert.", record.part137_cert_no || null],
  ];
  return (
    <div className="mt-3 border-t border-[#1f1f1f] pt-2.5">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
        Application record
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <Stat key={label} label={label} missing={!value}>{value}</Stat>
        ))}
      </div>
    </div>
  );
}

export function FlightLogTab({
  fieldId, fieldName, settings, openScan,
}: {
  fieldId: string | null;
  fieldName: string;
  /** Carries the one surviving application record (see the header note). */
  settings: FarmerSettings;
  openScan: (taskId: string) => void;
}) {
  const units = useUnitSystem();
  const [logs, setLogs] = useState<FlightLogRow[]>([]);
  const [drones, setDrones] = useState<DroneRow[]>([]);
  const [scanDates, setScanDates] = useState<Map<string, string>>(new Map());
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("flight_logs")
        .select("id, field_id, scan_id, drone_id, date_flown, battery_start, battery_end, tank_refills, zones_completed, acres_treated, liters_applied, notes, created_at")
        .eq("field_id", fieldId)
        .order("date_flown", { ascending: false });
      if (cancelled) return;
      if (err) {
        // A failed read is said, not rendered as "no flights" — those are very
        // different things to somebody checking their own compliance history.
        setError(err.message);
        setLoading(false);
        return;
      }
      const rows = (data as FlightLogRow[] | null) ?? [];
      setLogs(rows);

      const [{ data: d }, { data: r }] = await Promise.all([
        supabase.from("drones").select("id, name, model"),
        supabase.from("field_reports")
          .select("id, flight_log_id, storage_path, generated_at")
          .eq("field_id", fieldId),
      ]);
      if (cancelled) return;
      setDrones((d as DroneRow[] | null) ?? []);
      setReports((r as ReportRow[] | null) ?? []);

      const scanIds = [...new Set(rows.map(l => l.scan_id).filter((s): s is string => !!s))];
      if (scanIds.length) {
        const { data: tasks } = await supabase
          .from("odm_tasks").select("id, created_at").in("id", scanIds);
        if (!cancelled) {
          setScanDates(new Map(
            ((tasks as { id: string; created_at: string }[] | null) ?? [])
              .map(t => [t.id, t.created_at] as [string, string]),
          ));
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fieldId]);

  const droneById = useMemo(() => new Map(drones.map(d => [d.id, d])), [drones]);
  const reportByLog = useMemo(
    () => new Map(reports.filter(r => r.flight_log_id).map(r => [r.flight_log_id as string, r])),
    [reports],
  );

  // The one application record the system still keeps outside an archived PDF.
  const snapshot = settings.last_flown_mission;
  const recordForLog = (log: FlightLogRow): ApplicationRecord | null =>
    snapshot?.record && snapshot.id === log.id ? snapshot.record : null;

  // Totals over what was actually logged: a flight with no figure contributes
  // nothing rather than a zero, and how many those are is stated beside them.
  const totals = useMemo(() => ({
    acres: logs.reduce((s, l) => s + (l.acres_treated ?? 0), 0),
    litres: logs.reduce((s, l) => s + (l.liters_applied ?? 0), 0),
    missingAcres: logs.filter(l => l.acres_treated == null).length,
    missingVolume: logs.filter(l => l.liters_applied == null).length,
  }), [logs]);

  const openReport = async (r: ReportRow) => {
    const { data, error } = await supabase.storage.from("field-reports")
      .createSignedUrl(r.storage_path, 60 * 10);
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank", "noopener");
      return;
    }
    // A button that silently does nothing reads as broken software.
    toast.error("Couldn't open the report", {
      description: error?.message
        ? `The archive did not answer (${error.message}). Check your connection and try again.`
        : "The archive did not answer. Check your connection and try again.",
    });
  };

  return (
    <div className="absolute inset-0 overflow-auto bg-[#0f0f0f] text-[#f0f0f0]">
      <div className="mx-auto max-w-3xl space-y-5 p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Flight Log</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Every mission logged for {fieldName}, newest first. This is the record you keep,
            not a summary of it — nothing here is estimated or filled in.
          </p>
        </header>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading flight log…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded border border-red-900/50 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              The flight log could not be read ({error}). This is a loading failure, not an
              empty log — do not read it as "no flights".
            </div>
          </div>
        )}

        {!loading && !error && logs.length === 0 && (
          <div className="rounded border border-[#1f1f1f] bg-[#141414] p-8 text-center">
            <Plane className="mx-auto mb-3 h-7 w-7 text-neutral-600" />
            <div className="text-sm text-neutral-300">No flights logged for this field yet.</div>
            <div className="mt-1 text-[12px] text-neutral-500">
              After flying, log the mission from the Flight Planner. It appears here and becomes
              part of that scan's spray report.
            </div>
          </div>
        )}

        {!loading && logs.length > 0 && (
          <div className="grid grid-cols-3 gap-3 rounded border border-[#1f1f1f] bg-[#141414] p-4 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Flights</div>
              <div className="font-mono text-lg text-neutral-100">{logs.length}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Treated</div>
              <div className="font-mono text-lg text-neutral-100">{fmtAreaAc(totals.acres, units).text}</div>
              {totals.missingAcres > 0 && (
                <div className="text-[10px] text-amber-500/80">
                  {totals.missingAcres} flight{totals.missingAcres === 1 ? "" : "s"} without a figure
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Applied</div>
              <div className="font-mono text-lg text-neutral-100">{fmtVolume(totals.litres, units).text}</div>
              {totals.missingVolume > 0 && (
                <div className="text-[10px] text-amber-500/80">
                  {totals.missingVolume} flight{totals.missingVolume === 1 ? "" : "s"} without a figure
                </div>
              )}
            </div>
          </div>
        )}

        {logs.map(log => {
          const drone = log.drone_id ? droneById.get(log.drone_id) : null;
          const report = reportByLog.get(log.id);
          const record = recordForLog(log);
          const scanDate = log.scan_id ? scanDates.get(log.scan_id) : null;
          const zonesDone = log.zones_completed?.length ?? 0;
          return (
            <div key={log.id} className="rounded border border-[#1f1f1f] bg-[#141414] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 text-[#4CAF50]" />
                  <span className="text-sm font-medium">{longDate(log.date_flown)}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                  {drone
                    ? <span className="inline-flex items-center gap-1"><Plane className="h-3 w-3" />{drone.name} · {drone.model}</span>
                    : <span className="inline-flex items-center gap-1 text-neutral-600"><Plane className="h-3 w-3" />aircraft not recorded</span>}
                  {report && (
                    <button
                      type="button"
                      onClick={() => void openReport(report)}
                      className="inline-flex items-center gap-1 text-[#4CAF50] hover:underline"
                    >
                      <FileText className="h-3 w-3" /> Report
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Stat label="Treated" missing={log.acres_treated == null}>
                  {log.acres_treated != null && fmtAreaAc(log.acres_treated, units).text}
                </Stat>
                <Stat label="Volume applied" missing={log.liters_applied == null}>
                  {log.liters_applied != null && fmtVolume(log.liters_applied, units).text}
                </Stat>
                <Stat label="Battery" missing={log.battery_start == null && log.battery_end == null}>
                  {log.battery_start ?? "?"}% → {log.battery_end ?? "?"}%
                </Stat>
                <Stat label="Tank refills" missing={log.tank_refills == null}>
                  {log.tank_refills}
                </Stat>
              </div>

              {acreageFromBuggyPath(log) && (
                <p className="mt-2 rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-[11px] leading-snug text-amber-300/90">
                  {LEGACY_AREA_NOTE}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <Sprout className="h-3 w-3" />
                  {zonesDone} zone{zonesDone === 1 ? "" : "s"} completed
                </span>
                {log.scan_id ? (
                  <button
                    type="button"
                    onClick={() => openScan(log.scan_id as string)}
                    className="inline-flex items-center gap-1 hover:text-neutral-300"
                  >
                    <MapPin className="h-3 w-3" />
                    Flown against the {scanDate ? new Date(scanDate).toLocaleDateString() : "linked"} scan
                  </button>
                ) : (
                  <span className="text-neutral-600">not linked to a scan</span>
                )}
              </div>

              {log.notes && (
                <div className="mt-2 rounded-sm border border-[#1f1f1f] bg-[#0f0f0f] px-2.5 py-1.5 text-[12px] leading-relaxed text-neutral-300">
                  {log.notes}
                </div>
              )}

              {record
                ? <RecordBlock record={record} />
                : (
                  <div className="mt-3 border-t border-[#1f1f1f] pt-2 text-[10px] leading-snug text-neutral-600">
                    The application record for this flight is not stored on the flight row — only
                    the most recent flight's record is kept outside its generated report.
                    {report && " Open the report above for the full record as issued."}
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FlightLogTab;
