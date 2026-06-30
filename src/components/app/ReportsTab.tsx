import { useCallback, useEffect, useState } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { Loader2, Download, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import turfArea from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import {
  type FarmerSettings, type AiZone,
  INPUT_LABELS, COST_MAP, issueToCostKey,
} from "@/pages/app/OrthomosaicViewer";

// ---- Unit conversion helpers (litres are the canonical storage unit). ----
const L_TO_GAL = 0.264172;
function fmtVol(litres: number, system: FarmerSettings["unit_system"], digits = 1) {
  if (system === "imperial") return `${(litres * L_TO_GAL).toFixed(digits)} gal`;
  return `${litres.toFixed(digits)} L`;
}
function unitLabel(system: FarmerSettings["unit_system"]) {
  return system === "imperial" ? "gal" : "L";
}

// ---- Real geodesic area for a ring of {lat,lng} points using turf.
// Turf expects GeoJSON [lng, lat] and a closed ring.
function ringAreaM2(ring: { lat: number; lng: number }[]): number {
  if (!ring || ring.length < 3) return 0;
  const coords = ring.map(p => [p.lng, p.lat] as [number, number]);
  const first = coords[0], last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  try {
    return turfArea(turfPolygon([coords]));
  } catch {
    return 0;
  }
}
const M2_TO_AC = 1 / 4047; // square meters → acres
const HA_TO_AC = 2.4710538147;

type FieldRow = { id: string; name: string; boundary_area_hectares: number | null };
type TaskRow = { id: string; created_at: string };
type Analysis = { health_score: number; zones: AiZone[] } | null;
type DroneRow = { id: string; name: string; model: string; battery: number };
type FlightLogRow = {
  id: string; date_flown: string;
  battery_start: number | null; battery_end: number | null;
  tank_refills: number; zones_completed: string[] | null;
  acres_treated: number | null; liters_applied: number | null;
  notes: string | null;
};
type ReportRow = {
  id: string; generated_at: string; pilot_name: string | null;
  storage_path: string; summary: any;
};

type Props = {
  field: FieldRow | null;
  task: TaskRow;
  analysis: Analysis;
  settings: FarmerSettings;
  activeDrone: DroneRow | null;
  lastLog: FlightLogRow | null;
  // Switches viewer to a given tab key; we use it to flash Field View for capture.
  setActiveTab: (k: "field" | "weather" | "ai" | "planner" | "reports" | "settings") => void;
};

export default function ReportsTab({
  field, task, analysis, settings, activeDrone, lastLog, setActiveTab,
}: Props) {
  const [pilotName, setPilotName] = useState<string>(() => localStorage.getItem("acrespray.pilot_name") ?? "");
  const [generating, setGenerating] = useState(false);
  const [reports, setReports] = useState<ReportRow[]>([]);

  // ---- Editable mission fields. Prefilled from the last logged flight when
  //      available, but always overridable so the pilot can double-check / fix
  //      numbers before the report is generated.
  const [missionDate, setMissionDate] = useState<string>("");
  const [battStartIn, setBattStartIn] = useState<string>("");
  const [battEndIn, setBattEndIn] = useState<string>("");
  const [refillsIn, setRefillsIn] = useState<string>("");
  const [litersIn, setLitersIn] = useState<string>("");
  const [notesIn, setNotesIn] = useState<string>("");

  const unit = settings.unit_system ?? "imperial";
  const isImperial = unit === "imperial";

  // Whenever the logged-flight backing data changes, re-prefill the editable
  // fields. Pilot can still type over any of them.
  useEffect(() => {
    setMissionDate(lastLog?.date_flown ?? "");
    setBattStartIn(lastLog?.battery_start != null ? String(lastLog.battery_start) : "");
    setBattEndIn(lastLog?.battery_end != null ? String(lastLog.battery_end) : "");
    setRefillsIn(lastLog?.tank_refills != null ? String(lastLog.tank_refills) : "0");
    setLitersIn(
      lastLog?.liters_applied != null
        ? String(+(isImperial
            ? Number(lastLog.liters_applied) * L_TO_GAL
            : Number(lastLog.liters_applied)
          ).toFixed(2))
        : ""
    );
    setNotesIn(lastLog?.notes ?? "");
  }, [lastLog?.id, lastLog?.date_flown, lastLog?.battery_start, lastLog?.battery_end,
      lastLog?.tank_refills, lastLog?.liters_applied, lastLog?.notes, isImperial]);

  const loadReports = useCallback(async () => {
    if (!field?.id) return;
    const { data } = await supabase
      .from("field_reports")
      .select("id, generated_at, pilot_name, storage_path, summary")
      .eq("field_id", field.id)
      .order("generated_at", { ascending: false });
    setReports((data as ReportRow[] | null) ?? []);
  }, [field?.id]);
  useEffect(() => { void loadReports(); }, [loadReports]);

  useEffect(() => {
    localStorage.setItem("acrespray.pilot_name", pilotName);
  }, [pilotName]);

  // ---- Derived values (zones, chemical totals, savings) ----
  const zones = analysis?.zones ?? [];
  const zoneRows = zones.map(z => {
    const m2 = ringAreaM2(z.ring);
    const ac = m2 * M2_TO_AC;
    const flown = !!lastLog?.zones_completed?.includes(z.id);
    const costKey = issueToCostKey(z);
    const inputKey = costKey ? COST_MAP[costKey] : null;
    return { id: z.id, name: z.name, issue: z.issue, severity: z.severity,
             acres: ac, flown, inputKey, inputLabel: inputKey ? INPUT_LABELS[inputKey] : null };
  });

  const fieldAcres = field?.boundary_area_hectares != null
    ? field.boundary_area_hectares * HA_TO_AC : 0;
  const treatedAcres = zoneRows.reduce((s, z) => s + z.acres, 0);

  // Chemical usage: 10 L/ha default application rate × zone acres → litres by input.
  const DOSE_L_PER_AC = 4.05; // ~10 L/ha
  type Bucket = { label: string; litres: number };
  const buckets = new Map<string, Bucket>();
  for (const z of zoneRows) {
    if (!z.inputKey || !z.inputLabel) continue;
    const litres = z.acres * DOSE_L_PER_AC;
    const prev = buckets.get(z.inputKey);
    if (prev) prev.litres += litres;
    else buckets.set(z.inputKey, { label: z.inputLabel, litres });
  }
  const totalLitres = [...buckets.values()].reduce((s, b) => s + b.litres, 0);
  const fullFieldLitres = fieldAcres * DOSE_L_PER_AC;
  const savingsPct = fullFieldLitres > 0
    ? Math.max(0, Math.min(100, Math.round((1 - totalLitres / fullFieldLitres) * 100)))
    : 0;

  // Pre-flight vs post-flight framing.
  // Post-flight = a mission has been logged for this field.
  const isPostFlight = !!lastLog;
  const targetedAcres = isPostFlight
    ? zoneRows.filter(z => z.flown).reduce((s, z) => s + z.acres, 0)
    : treatedAcres;
  const untreatedPct = fieldAcres > 0
    ? Math.max(0, Math.min(100, (1 - targetedAcres / fieldAcres) * 100))
    : 0;
  const untreatedPctLabel = untreatedPct >= 99.95
    ? untreatedPct.toFixed(2)
    : untreatedPct >= 10 ? untreatedPct.toFixed(1) : untreatedPct.toFixed(2);
  const headlineBig = isPostFlight
    ? `${savingsPct}% less chemical`
    : `${untreatedPctLabel}% of field stays unsprayed`;
  const headlineSub = isPostFlight
    ? "vs. full-field spraying"
    : `Targeting ${targetedAcres.toFixed(2)} ac of ${fieldAcres.toFixed(2)} ac total`;

  // ---- Mission stats from the editable inputs (prefilled from last log). ----
  const numOrNull = (s: string) => {
    const t = s.trim(); if (!t) return null;
    const n = Number(t); return Number.isFinite(n) ? n : null;
  };
  const battStart = numOrNull(battStartIn);
  const battEnd = numOrNull(battEndIn);
  const tankRefills = numOrNull(refillsIn) ?? 0;
  // The "Volume applied" input is shown in whichever units the user picked,
  // but everything downstream (DB row, PDF math) is normalised back to L.
  const volumeAppliedRaw = numOrNull(litersIn);
  const litersApplied = volumeAppliedRaw == null
    ? null
    : (isImperial ? volumeAppliedRaw / L_TO_GAL : volumeAppliedRaw);
  const pilotNotes = notesIn;

  // ---- PDF generation ----
  const generate = async () => {
    if (!field) { toast.error("Define a field boundary first."); return; }
    if (!pilotName.trim()) { toast.error("Enter a pilot name first."); return; }
    if (!missionDate) { toast.error("Enter the mission date first."); return; }
    setGenerating(true);
    let restored = false;
    const capRoot = document.getElementById("field-view-capture");
    const prevVisibility = capRoot?.style.visibility ?? "";
    const prevPointer = capRoot?.style.pointerEvents ?? "";
    try {
      // 1) Make sure the map is on-screen for html2canvas, then give tiles a beat
      //    to load before snapshotting.
      setActiveTab("field");
      await new Promise(r => setTimeout(r, 50));
      if (capRoot) {
        capRoot.style.visibility = "visible";
        capRoot.style.pointerEvents = "none";
      }
      // Wait for tiles to settle.
      await new Promise(r => setTimeout(r, 900));

      let mapDataUrl: string | null = null;
      const mapEl = capRoot?.querySelector(".leaflet-container") as HTMLElement | null;
      if (mapEl) {
        try {
          const canvas = await html2canvas(mapEl, {
            useCORS: true, allowTaint: false, backgroundColor: "#0a0a0a",
            logging: false, scale: 1.5,
          });
          mapDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        } catch (err) {
          console.warn("map capture failed", err);
        }
      }

      // 2) Restore Reports tab and any hidden state.
      if (capRoot) {
        capRoot.style.visibility = prevVisibility;
        capRoot.style.pointerEvents = prevPointer;
      }
      setActiveTab("reports");
      restored = true;

      // 3) Build the PDF.
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const W = pdf.internal.pageSize.getWidth();
      const M = 36;
      let y = M;
      const today = new Date();
      const ymd = today.toISOString().slice(0, 10);
      const niceDate = today.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      const scanDate = new Date(task.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      const missionDateNice = missionDate
        ? new Date(missionDate + "T00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
        : "—";

      // Header
      pdf.setFont("helvetica", "bold"); pdf.setTextColor(76, 175, 80);
      pdf.setFontSize(16); pdf.text("AcreSpray AI", M, y);
      pdf.setFont("helvetica", "normal"); pdf.setTextColor(120);
      pdf.setFontSize(10); pdf.text(niceDate, W - M, y, { align: "right" });
      y += 8;
      pdf.setDrawColor(220); pdf.setLineWidth(0.5); pdf.line(M, y, W - M, y);
      y += 18;
      pdf.setFont("helvetica", "bold"); pdf.setTextColor(30);
      pdf.setFontSize(20); pdf.text("FIELD SPRAY REPORT", M, y);
      y += 22;

      // Meta grid
      pdf.setFontSize(9); pdf.setTextColor(110); pdf.setFont("helvetica", "bold");
      const meta: [string, string][] = [
        ["FIELD", field.name],
        ["CROP TYPE", settings.crop_type ? settings.crop_type.replace(/_/g, " ") : "—"],
        ["TOTAL AREA", `${fieldAcres.toFixed(2)} acres`],
        ["SCAN DATE", scanDate],
        ["MISSION DATE", missionDateNice],
        ["PILOT", pilotName.trim()],
        ["DRONE", activeDrone ? `${activeDrone.name} · ${activeDrone.model}` : "— Not assigned —"],
      ];
      const labelW = 90;
      for (const [k, v] of meta) {
        pdf.setFont("helvetica", "bold"); pdf.setTextColor(110); pdf.setFontSize(8);
        pdf.text(k, M, y);
        pdf.setFont("helvetica", "normal"); pdf.setTextColor(20); pdf.setFontSize(10);
        pdf.text(v, M + labelW, y);
        y += 14;
      }
      y += 6;
      pdf.setDrawColor(220); pdf.line(M, y, W - M, y); y += 14;

      // Field map
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(110);
      pdf.text("FIELD MAP", M, y); y += 10;
      if (mapDataUrl) {
        const imgW = W - 2 * M;
        const imgH = imgW * 0.45;
        pdf.addImage(mapDataUrl, "JPEG", M, y, imgW, imgH);
        y += imgH + 12;
      } else {
        pdf.setFontSize(9); pdf.setTextColor(150);
        pdf.text("Map preview unavailable — tiles could not be captured.", M, y + 4);
        y += 24;
      }
      pdf.setDrawColor(220); pdf.line(M, y, W - M, y); y += 14;

      // Headline savings callout
      pdf.setFillColor(76, 175, 80);
      pdf.roundedRect(M, y, W - 2 * M, 56, 6, 6, "F");
      pdf.setTextColor(255); pdf.setFont("helvetica", "bold");
      pdf.setFontSize(isPostFlight ? 26 : 20);
      pdf.text(headlineBig, M + 16, y + 30);
      pdf.setFontSize(10); pdf.setFont("helvetica", "normal");
      pdf.text(headlineSub, M + 16, y + 46);
      y += 70;

      // Treatment zones
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(110);
      pdf.text("TREATMENT ZONES", M, y); y += 12;
      pdf.setFontSize(10); pdf.setTextColor(30); pdf.setFont("helvetica", "normal");
      if (zoneRows.length === 0) {
        pdf.setTextColor(150);
        pdf.text("No AI zones — run an analysis first.", M, y); y += 16;
      } else {
        for (const z of zoneRows) {
          pdf.setTextColor(30); pdf.setFont("helvetica", "bold");
          pdf.text(z.name, M, y);
          pdf.setFont("helvetica", "normal"); pdf.setTextColor(110);
          pdf.text(z.issue, M + 130, y);
          pdf.setTextColor(30);
          pdf.text(`${z.acres.toFixed(2)} ac`, W - M - 110, y, { align: "right" });
          pdf.setTextColor(z.flown ? 76 : 150);
          if (z.flown) {
            pdf.setFont("helvetica", "bold"); pdf.setTextColor(34, 139, 34);
            pdf.text("Flown", W - M, y, { align: "right" });
          } else {
            pdf.setFont("helvetica", "normal"); pdf.setTextColor(170);
            pdf.text("Pending", W - M, y, { align: "right" });
          }
          y += 14;
        }
      }
      y += 6;
      pdf.setDrawColor(220); pdf.line(M, y, W - M, y); y += 14;

      // Chemical usage
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(110);
      pdf.text("CHEMICAL USAGE (EST.)", M, y); y += 12;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(30);
      if (buckets.size === 0) {
        pdf.setTextColor(150);
        pdf.text("No chemical-mapped zones.", M, y); y += 14;
      } else {
        for (const b of buckets.values()) {
          pdf.setTextColor(30); pdf.text(b.label, M, y);
          pdf.text(fmtVol(b.litres, unit), W - M, y, { align: "right" });
          y += 14;
        }
        pdf.setDrawColor(235); pdf.line(M, y - 4, W - M, y - 4);
        pdf.setFont("helvetica", "bold");
        pdf.text("Total applied", M, y);
        pdf.text(fmtVol(totalLitres, unit), W - M, y, { align: "right" });
        y += 14;
        pdf.setFont("helvetica", "normal"); pdf.setTextColor(76, 175, 80);
        pdf.text("Chemical saved vs full-field spray", M, y);
        pdf.text(`${savingsPct}%`, W - M, y, { align: "right" });
        y += 16;
      }
      pdf.setTextColor(30);
      pdf.setDrawColor(220); pdf.line(M, y, W - M, y); y += 14;

      // Mission stats
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(110);
      pdf.text("MISSION STATS", M, y); y += 12;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(30);
      const colW = (W - 2 * M) / 2;
      const stats: [string, string, string, string][] = [
        ["Spray distance", treatedAcres > 0 ? `${treatedAcres.toFixed(2)} ac sprayed` : "—",
         "Tank refills", String(tankRefills)],
        ["Battery start", battStart != null ? `${battStart}%` : "—",
         "Landed", battEnd != null ? `${battEnd}%` : "—"],
        [`Volume applied (logged)`, litersApplied != null ? fmtVol(litersApplied, unit) : "—",
         "Zones flown", `${zoneRows.filter(z => z.flown).length} / ${zoneRows.length}`],
      ];
      for (const [k1, v1, k2, v2] of stats) {
        pdf.setTextColor(110); pdf.text(k1, M, y);
        pdf.setTextColor(30); pdf.text(v1, M + colW - 12, y, { align: "right" });
        pdf.setTextColor(110); pdf.text(k2, M + colW + 12, y);
        pdf.setTextColor(30); pdf.text(v2, W - M, y, { align: "right" });
        y += 14;
      }
      y += 6;
      pdf.setDrawColor(220); pdf.line(M, y, W - M, y); y += 14;

      // Pilot notes
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(110);
      pdf.text("PILOT NOTES", M, y); y += 12;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(30);
      const notes = pilotNotes?.trim() || "—";
      const wrapped = pdf.splitTextToSize(notes, W - 2 * M);
      pdf.text(wrapped, M, y);
      y += wrapped.length * 12 + 10;

      // Footer
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(150);
      pdf.text("Generated by AcreSpray AI · acresprayai.com", W / 2, pdf.internal.pageSize.getHeight() - 18, { align: "center" });

      const blob = pdf.output("blob");
      const safeName = field.name.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "Field";
      const filename = `${safeName}_SprayReport_${ymd}.pdf`;

      // 4) Trigger download for the user.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      // 5) Upload to private storage + persist row.
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in.");
      const storagePath = `${uid}/${field.id}/${task.id}/${Date.now()}.pdf`;
      const up = await supabase.storage.from("field-reports")
        .upload(storagePath, blob, { contentType: "application/pdf", upsert: false });
      if (up.error) throw up.error;

      const summary = {
        pilot_name: pilotName.trim(),
        field_acres: fieldAcres,
        treated_acres: treatedAcres,
        total_litres: totalLitres,
        savings_pct: savingsPct,
        health_score: analysis?.health_score ?? null,
        zones_total: zoneRows.length,
        zones_flown: zoneRows.filter(z => z.flown).length,
        drone: activeDrone ? { name: activeDrone.name, model: activeDrone.model } : null,
        mission_date: missionDate,
      };
      const ins = await supabase.from("field_reports").insert({
        user_id: uid,
        field_id: field.id,
        scan_id: task.id,
        flight_log_id: lastLog?.id ?? null,
        pilot_name: pilotName.trim(),
        storage_path: storagePath,
        summary,
      });
      if (ins.error) throw ins.error;

      toast.success("Report generated and archived.");
      await loadReports();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Failed to generate report");
    } finally {
      if (!restored && capRoot) {
        capRoot.style.visibility = prevVisibility;
        capRoot.style.pointerEvents = prevPointer;
      }
      setGenerating(false);
    }
  };

  const openArchived = async (r: ReportRow) => {
    const { data, error } = await supabase.storage.from("field-reports")
      .createSignedUrl(r.storage_path, 60 * 10);
    if (error || !data?.signedUrl) { toast.error("Couldn't open report"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div className="absolute inset-0 overflow-auto bg-[#0f0f0f] text-[#f0f0f0]">
      <div className="max-w-3xl mx-auto p-8 space-y-6">
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Spray Mission Report</h1>
            <p className="text-sm text-neutral-400 mt-1">
              One-page PDF summarising this scan, the AI treatment zones, chemical usage, and your last logged flight.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              {isPostFlight ? "Savings" : "Targeted"}
            </div>
            <div className="text-3xl font-semibold text-[#4CAF50] tabular-nums">
              {isPostFlight ? `${savingsPct}%` : `${targetedAcres.toFixed(2)} ac`}
            </div>
            <div className="text-[11px] text-neutral-500">
              {isPostFlight ? "vs. full-field" : `of ${fieldAcres.toFixed(2)} ac total`}
            </div>
          </div>
        </header>

        <div className="rounded-md border border-[#1f1f1f] bg-[#141414] p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-neutral-500 uppercase tracking-wider text-[10px] mb-1">Field</div>
              <div className="text-neutral-200">{field?.name ?? "—"}</div>
            </div>
            <div>
              <div className="text-neutral-500 uppercase tracking-wider text-[10px] mb-1">Total area</div>
              <div className="text-neutral-200">{fieldAcres > 0 ? `${fieldAcres.toFixed(2)} ac` : "Boundary not defined"}</div>
            </div>
            <div>
              <div className="text-neutral-500 uppercase tracking-wider text-[10px] mb-1">Crop</div>
              <div className="text-neutral-200">{settings.crop_type ? settings.crop_type.replace(/_/g, " ") : "—"}</div>
            </div>
            <div>
              <div className="text-neutral-500 uppercase tracking-wider text-[10px] mb-1">Drone</div>
              <div className="text-neutral-200">{activeDrone ? `${activeDrone.name} · ${activeDrone.model}` : "Not assigned"}</div>
            </div>
            <div>
              <div className="text-neutral-500 uppercase tracking-wider text-[10px] mb-1">AI zones</div>
              <div className="text-neutral-200">{zoneRows.length} ({zoneRows.filter(z => z.flown).length} flown)</div>
            </div>
          </div>

          {/* ---- Mission details: required before generating. Prefilled from
                  the last logged flight so the pilot can double-check / edit. ---- */}
          <div className="pt-3 border-t border-[#1f1f1f] space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Mission details</div>
              {lastLog && (
                <div className="text-[10px] text-neutral-500">Prefilled from logged flight · editable</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">
                  Mission date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={missionDate}
                  onChange={e => setMissionDate(e.target.value)}
                  className="w-full h-9 px-3 rounded bg-[#0f0f0f] border border-[#262626] text-sm text-neutral-100 focus:outline-none focus:border-[#4CAF50]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Battery start (%)</label>
                <input
                  type="number" min={0} max={100} placeholder="e.g. 100"
                  value={battStartIn}
                  onChange={e => setBattStartIn(e.target.value)}
                  className="w-full h-9 px-3 rounded bg-[#0f0f0f] border border-[#262626] text-sm text-neutral-100 focus:outline-none focus:border-[#4CAF50]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Battery landed (%)</label>
                <input
                  type="number" min={0} max={100} placeholder="e.g. 32"
                  value={battEndIn}
                  onChange={e => setBattEndIn(e.target.value)}
                  className="w-full h-9 px-3 rounded bg-[#0f0f0f] border border-[#262626] text-sm text-neutral-100 focus:outline-none focus:border-[#4CAF50]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Tank refills</label>
                <input
                  type="number" min={0} step={1} placeholder="0"
                  value={refillsIn}
                  onChange={e => setRefillsIn(e.target.value)}
                  className="w-full h-9 px-3 rounded bg-[#0f0f0f] border border-[#262626] text-sm text-neutral-100 focus:outline-none focus:border-[#4CAF50]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">
                  Volume applied ({unitLabel(unit)})
                </label>
                <input
                  type="number" min={0} step={0.1} placeholder={isImperial ? "e.g. 3.3" : "e.g. 12.5"}
                  value={litersIn}
                  onChange={e => setLitersIn(e.target.value)}
                  className="w-full h-9 px-3 rounded bg-[#0f0f0f] border border-[#262626] text-sm text-neutral-100 focus:outline-none focus:border-[#4CAF50]"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Pilot notes</label>
                <textarea
                  value={notesIn}
                  onChange={e => setNotesIn(e.target.value)}
                  rows={2}
                  placeholder="Wind picked up around 3pm, refilled tank between zones 3 and 4…"
                  className="w-full px-3 py-2 rounded bg-[#0f0f0f] border border-[#262626] text-sm text-neutral-100 focus:outline-none focus:border-[#4CAF50] resize-none"
                />
              </div>
            </div>
            {!lastLog && (
              <div className="text-[11px] text-neutral-500">
                No flight logged for this scan yet — fill in the numbers manually, or log the mission from the Planner to auto-fill.
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Pilot name</label>
            <input
              value={pilotName}
              onChange={e => setPilotName(e.target.value)}
              placeholder="e.g. Sam Chen"
              className="w-full h-9 px-3 rounded bg-[#0f0f0f] border border-[#262626] text-sm text-neutral-100 focus:outline-none focus:border-[#4CAF50]"
            />
          </div>

          <button
            onClick={generate}
            disabled={generating || !field || !missionDate || !pilotName.trim()}
            className="w-full h-10 rounded bg-[#4CAF50] hover:bg-[#43a047] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating
              ? (<><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>)
              : (<><Download className="h-4 w-4" /> Download Report</>)}
          </button>
          {!analysis && (
            <div className="text-[11px] text-yellow-400/90 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Run an AI analysis first for treatment zones and chemical savings.
            </div>
          )}
        </div>

        <section>
          <h2 className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Report archive</h2>
          {reports.length === 0 ? (
            <div className="text-sm text-neutral-500 italic">No reports yet.</div>
          ) : (
            <ul className="space-y-1">
              {reports.map(r => (
                <li key={r.id}>
                  <button
                    onClick={() => openArchived(r)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded border border-[#1f1f1f] bg-[#141414] hover:bg-[#1a1a1a] text-left text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 text-[#4CAF50]" />
                    <span className="text-neutral-200 flex-1">
                      {new Date(r.generated_at).toLocaleString()}
                      {r.pilot_name ? ` · ${r.pilot_name}` : ""}
                    </span>
                    {r.summary?.savings_pct != null && (
                      <span className="text-[#4CAF50] tabular-nums">{r.summary.savings_pct}% saved</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}