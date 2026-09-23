// What the scan found, in three numbers and one button.
//
// This is the whole of the results surface that is not the map. The spots
// themselves are reviewed where they are, by clicking them (SpotPopup): the
// scout has already decided every one of them, so the operator's job is to
// correct the wrong ones, not to work a list of thirty rows.
//
// It computes nothing. The acreage comes from lib/treatment/plannedArea.ts,
// the same function the Flight Planner prices its chemical with, so the figure
// here and the figure one tab over cannot disagree. Where a number is not
// available, it says so: a field with no recorded boundary area produces no
// percentage rather than a division by a number nobody wrote down.
import { AlertTriangle, Loader2, Plane } from "lucide-react";
import { type UnitSystem, fmtArea } from "@/lib/units";

export type ScanSummaryProps = {
  spots: number;
  kept: number;
  removed: number;
  unsure: number;
  /** Ground the kept spots cover, from plannedAreas. */
  treatAreaM2: number;
  /** The field's own area, or null when no boundary area is on file. */
  fieldAreaM2: number | null;
  units: UnitSystem;
  onBuildMission: () => void;
  /** Non-null while saving. */
  building: { done: number; total: number } | null;
  buildError: string | null;
  canBuild: boolean;
};

export function ScanSummary({
  spots, kept, removed, unsure, treatAreaM2, fieldAreaM2, units,
  onBuildMission, building, buildError, canBuild,
}: ScanSummaryProps) {
  const area = (m2: number) => fmtArea(m2, units).text;
  const untreatedPct = fieldAreaM2 && fieldAreaM2 > 0
    ? Math.max(0, Math.min(100, 100 - (treatAreaM2 / fieldAreaM2) * 100))
    : null;

  return (
    <section className="p-4 border-b border-[#1f1f1f] space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Spots" value={String(spots)} note={`${kept} kept, ${removed} removed, ${unsure} unsure`} />
        <Stat label="To treat" value={area(treatAreaM2)}
          note={fieldAreaM2 ? `of ${area(fieldAreaM2)}` : "field area not on file"} />
        <Stat
          label="Needs nothing"
          value={untreatedPct != null ? `${untreatedPct.toFixed(0)}%` : "Not known"}
          note={untreatedPct != null ? "of the field" : "no boundary area on file"}
          muted={untreatedPct == null}
        />
      </div>

      <p className="text-[11px] text-neutral-500">
        Every spot is already decided. Click one on the map to change it; the colour is the decision.
      </p>

      {spots > 0 && (
        <>
          <button type="button" onClick={onBuildMission} disabled={!canBuild || !!building}
            className="w-full inline-flex items-center justify-center gap-2 text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 text-black rounded-sm px-3 py-2 font-semibold">
            {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plane className="h-3.5 w-3.5" />}
            {building
              ? `Saving ${building.done}/${building.total}`
              : `Save ${spots} spot${spots === 1 ? "" : "s"} and open the Flight Planner`}
          </button>
          <p className="text-[10px] text-neutral-500">
            Puts the {kept} kept spot{kept === 1 ? "" : "s"} on the field and applies your own rates, drone and tank
            settings. No product or rate is chosen for you.
          </p>
          {buildError && (
            <p className="text-[11px] text-red-400 inline-flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{buildError}
            </p>
          )}
          {!canBuild && <p className="text-[11px] text-neutral-500">Sign in to save.</p>}
        </>
      )}
      {spots === 0 && (
        <p className="text-[11px] text-neutral-400">
          Nothing stood out at these settings. That is a result, not an absence.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, note, muted }: { label: string; value: string; note: string; muted?: boolean }) {
  return (
    <div className="rounded-sm border border-[#222] p-2" style={{ background: "#0f0f0f" }}>
      <div className="text-[9px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`text-base font-medium leading-tight ${muted ? "text-neutral-500" : "text-neutral-100"}`}>{value}</div>
      <div className="text-[10px] text-neutral-500 leading-tight">{note}</div>
    </div>
  );
}

export default ScanSummary;
