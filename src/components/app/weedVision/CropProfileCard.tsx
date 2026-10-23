// What the crop profile expects of this field, what the scan measured, and which analyses that leaves on, for review,
// or off, each with its reason. Composes the profile's checks (src/lib/cropProfiles/checks.ts); computes nothing of
// its own. Weeds listed are the ones commonly reported in the crop for the field's region and stage: a reference
// list, never an identification.
import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { type CapabilityVerdict, assessCapabilities, regionFor, speciesPriors } from "@/lib/cropProfiles/checks";
import { cropProfileFor } from "@/lib/cropProfiles/registry";
import { fmtLengthCm, type UnitSystem } from "@/lib/units";

export type CropProfileObservations = {
  /** Ground size of the imagery's pixel, metres, or null when unknown. */
  gsdM: number | null;
  measuredRowSpacingM: number | null;
  /** Null before a scan has looked for rows. */
  rowsFound: boolean | null;
  vegetationShare?: number | null;
};

/** The analyses shown first; the rest are behind "all analyses". */
const KEY = ["row-detection", "crop-vs-weed-by-position", "between-row-weed-cover", "weed-pressure-grade", "planting-positions", "weed-measurement"];
const LABEL: Record<string, string> = {
  "row-detection": "Crop rows", "row-spacing": "Row spacing", "planting-positions": "Plant positions", "crop-vs-weed-by-position": "Weed vs crop by position",
  "vegetation-segmentation": "Green vs ground", "between-row-weed-cover": "Weed cover between rows", "weed-pressure-grade": "Weed pressure grade", hotspots: "Hotspots",
  "weed-isolation": "Single weeds", "weed-measurement": "Weed size", "species-priors": "Weed species list", "stand-count": "Stand count",
  "growth-stage-from-imagery": "Stage from imagery", "stage-estimate": "Stage from planting date", "canopy-height": "Canopy height",
};
const DOT: Record<CapabilityVerdict["state"], string> = { enabled: "#4CAF50", review: "#FFB300", disabled: "#616161" };
const STATE: Record<CapabilityVerdict["state"], string> = { enabled: "on", review: "review", disabled: "off" };

export function CropProfileCard({ crop, plantingDate, observations, units, regionState = null, on }: { crop: string | null; plantingDate: string | null; observations: CropProfileObservations; units: UnitSystem; regionState?: string | null; on?: Date }) {
  const [open, setOpen] = useState(false);
  const profile = useMemo(() => cropProfileFor(crop), [crop]);
  const date = on ?? new Date();
  const assessment = useMemo(() => profile ? assessCapabilities(profile, { gsdM: observations.gsdM, plantingDate, on: date, measuredRowSpacingM: observations.measuredRowSpacingM, rowsFound: observations.rowsFound, vegetationShare: observations.vegetationShare ?? null }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, plantingDate, observations.gsdM, observations.measuredRowSpacingM, observations.rowsFound, observations.vegetationShare]);

  if (!crop?.trim()) return (
    <div className="p-4 border-b border-[#1f1f1f] text-[11px] text-neutral-400" data-testid="crop-profile-card">
      <p className="inline-flex items-center gap-1.5 text-neutral-300"><BookOpen className="h-3.5 w-3.5" /> No crop set for this field. Set it under Settings so the analysis knows what to expect.</p>
    </div>
  );
  if (!profile || !assessment) return (
    <div className="p-4 border-b border-[#1f1f1f] text-[11px] text-neutral-400" data-testid="crop-profile-card">
      <p className="inline-flex items-center gap-1.5 text-neutral-300"><BookOpen className="h-3.5 w-3.5" /> No crop profile for {crop} yet: the analysis runs with its crop-neutral settings.</p>
    </div>
  );

  const len = (m: number) => fmtLengthCm(m * 100, units).text;
  const st = assessment.stage;
  const region = regionFor(profile, { state: regionState });
  const priors = speciesPriors(profile, region, st, 5);
  const spacing = observations.measuredRowSpacingM;
  const spacingFinding = assessment.findings.find(f => f.code === "ROW_SPACING_UNEXPECTED");
  const caps = assessment.capabilities;
  const shown = open ? caps : caps.filter(c => KEY.includes(c.id));
  const name = profile.name[0].toUpperCase() + profile.name.slice(1);
  return (
    <div className="p-4 border-b border-[#1f1f1f] space-y-2 text-[11px]" data-testid="crop-profile-card">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold inline-flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5 text-[#4CAF50]" /> {name} profile</h3>
        <span className="text-[10px] uppercase tracking-wider text-neutral-400 border border-[#333] rounded-sm px-1.5 py-0.5" title={`Profile version ${profile.version}`}>{profile.status}</span>
      </div>
      <p className="text-neutral-400" data-testid="crop-profile-stage">
        {st.status === "estimated"
          ? <>Stage: about <span className="text-neutral-200">{st.from.id === st.to.id ? st.from.id : `${st.from.id} to ${st.to.id}`}</span>, {st.daysAfterPlanting} days after planting. Estimated from the planting date, not seen in the imagery; often off by {st.errorStages} leaf stages or more.</>
          : <>Stage unknown: {st.reason} Closure and the weed-free window are not checked.</>}
      </p>
      <p className="text-neutral-400" data-testid="crop-profile-spacing">
        Rows usually {len(profile.rowReader.defaultSpacingM)} apart ({profile.plantedSpacingsM.length} planted spacings on file).
        {spacing != null && <> Measured <span className="text-neutral-200">{len(spacing)}</span>{spacingFinding ? <span className="text-amber-400">: not a spacing {profile.name} is planted at; the measurement stands, check the crop or the read.</span> : ": consistent."}</>}
      </p>
      <ul className="space-y-1" data-testid="crop-profile-capabilities">
        {shown.map(c => {
          const why = c.findings.find(f => f.action !== "note") ?? null;
          return (
            <li key={c.id} className="flex gap-2" data-testid={`capability-${c.id}`} data-state={c.state}>
              <span className="mt-1 inline-block w-2 h-2 rounded-full shrink-0" style={{ background: DOT[c.state] }} />
              <span>
                <span className="text-neutral-200">{LABEL[c.id] ?? c.id}</span> <span className="text-neutral-500">{STATE[c.state]}{c.status === "experimental" && c.state !== "disabled" ? ", experimental" : ""}</span>
                {why && <span className="block text-neutral-500">{why.detail ?? why.message}</span>}
                {!why && c.state === "disabled" && <span className="block text-neutral-500">{c.reason}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-300 underline">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} {open ? "fewer analyses" : "all analyses and notes"}
      </button>
      {open && (
        <ul className="space-y-1 text-neutral-500" data-testid="crop-profile-findings">
          {assessment.findings.map((f, i) => <li key={i}><span className="text-neutral-400">{f.message}</span>{f.detail ? ` ${f.detail}` : ""}</li>)}
          {caps.flatMap(c => c.findings.filter(f => f.code === "WITHIN_ROW_UNRESOLVED" || f.code === "THRESHOLD_PROVISIONAL")).filter((f, i, a) => a.findIndex(x => x.code === f.code) === i).map(f => <li key={f.code}>{f.message}</li>)}
        </ul>
      )}
      {priors.length > 0 && (
        <div className="text-neutral-400" data-testid="crop-profile-weeds">
          <p>Weeds commonly reported in {profile.name} here{st.status === "estimated" ? " around this stage" : ""} (a reference list, not an identification):</p>
          <p className="text-neutral-300">{priors.map(p => `${p.name}${p.inSeason === true ? "" : p.inSeason === false ? " (later or earlier)" : ""}`).join(", ")}.</p>
        </div>
      )}
    </div>
  );
}
