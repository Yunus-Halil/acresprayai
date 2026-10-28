// Explore Findings: the filter control (mode, threshold, row relation) and the results panel (sortable list with
// every qualifying finding, paged so a million-observation field never puts a million rows in the DOM). Selecting
// a result zooms to the actual object and highlights it.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { type Finding, type FindingMode, type FindingsQuery, type FindingsResult, MODE_LABEL, findingValueText } from "@/lib/fieldTwin/findings";
import { TWIN_COLOURS } from "@/lib/fieldTwin/style";
import { fmtArea, fmtAreaCm2, type UnitSystem } from "@/lib/units";

export type SortKey = "rank" | "size" | "confidence" | "members";

type ControlProps = {
  query: FindingsQuery;
  onChange: (q: FindingsQuery) => void;
  result: FindingsResult | null;
  open: boolean;
  onToggle: () => void;
};

const MODES: FindingMode[] = ["overview", "largest", "clusters", "pressure", "extent", "confidence", "rows"];
const MODE_HINT: Record<FindingMode, string> = {
  overview: "Regions ranked by total verified cover.",
  largest: "One candidate's measured ground cover.",
  clusters: "Connected candidates, ranked by the ground they span.",
  pressure: "Cover as a share of the observable ground.",
  extent: "Ground affected, however dense.",
  confidence: "The detector's score; agreement across photographs listed beside it.",
  rows: "Candidates on a crop row or between rows.",
};

const panel = "rounded-md border border-[#343834] bg-[#171a17]";
const input = "w-full rounded-sm border border-[#3a3f3a] bg-[#111311] px-1.5 py-1 text-xs text-neutral-100";

/** The area of one small thing in the account's units (square centimetres or square feet below a square metre). */
export const areaText = (m2: number, u: UnitSystem) => (m2 < 1 ? fmtAreaCm2(m2 * 10_000, u).text : fmtArea(m2, u).text);

export function FindingsControl({ query, onChange, result, open, onToggle }: ControlProps) {
  const set = (patch: Partial<FindingsQuery>) => onChange({ ...query, ...patch });
  const m = query.mode;
  const threshold = (() => {
    if (m === "largest" || m === "rows") return { label: "Least ground cover, m²", key: "minAreaM2" as const, value: query.minAreaM2 ?? 0, step: 0.01, min: 0 };
    if (m === "clusters") return { label: "Least footprint, m²", key: "minFootprintM2" as const, value: query.minFootprintM2 ?? 0, step: 0.1, min: 0 };
    if (m === "pressure" || m === "extent") return { label: "Regions at cover of at least, %", key: "minCoverPct" as const, value: query.minCoverPct ?? 1.5, step: 0.5, min: 0.5 };
    if (m === "confidence") return { label: "Least model score, %", key: "minScore" as const, value: Math.round((query.minScore ?? 0) * 100), step: 5, min: 0 };
    return null;
  })();
  return (
    <div className={`w-[272px] text-sm ${panel}`}>
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-neutral-100" onClick={onToggle} aria-expanded={open}>
        <span>Explore findings</span>{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="border-t border-[#2e322e] px-3 py-2">
          <label className="block text-[11px] text-neutral-400" htmlFor="twin-mode">Show</label>
          <select id="twin-mode" value={m} onChange={e => onChange({ mode: e.target.value as FindingMode })} className={`mt-0.5 ${input}`}>
            {MODES.map(k => <option key={k} value={k}>{MODE_LABEL[k]}</option>)}
          </select>
          <p className="mt-1 text-[10px] leading-snug text-neutral-500">{MODE_HINT[m]}</p>
          {threshold && (
            <label className="mt-2 block text-[11px] text-neutral-400">{threshold.label}
              <input type="number" min={threshold.min} step={threshold.step} value={threshold.value} className={`mt-0.5 ${input}`} aria-label={threshold.label}
                onChange={e => { const v = Number(e.target.value); set({ [threshold.key]: threshold.key === "minScore" ? Math.max(0, Math.min(1, v / 100)) : Math.max(threshold.min, v) }); }} />
            </label>
          )}
          {(m === "largest" || m === "clusters" || m === "confidence" || m === "rows") && (
            <label className="mt-2 block text-[11px] text-neutral-400">Crop rows
              <select value={query.rowRelation ?? (m === "rows" ? "on a row" : "any")} onChange={e => set({ rowRelation: e.target.value as FindingsQuery["rowRelation"] })} className={`mt-0.5 ${input}`} aria-label="Crop-row relationship">
                <option value="any">Either</option><option value="on a row">On a crop row</option><option value="between rows">Between rows</option>
              </select>
            </label>
          )}
          {result && (
            <p className="mt-2 text-[11px] text-neutral-300">
              <span className="font-semibold text-neutral-100">{result.findings.length.toLocaleString()}</span> qualifying
              {result.prominence.rule === "dominant" && <>, <span className="font-semibold text-neutral-100">{result.prominence.count}</span> stand{result.prominence.count === 1 ? "s" : ""} clearly apart (next one {result.prominence.breakRatio === Infinity ? "far" : `${result.prominence.breakRatio!.toFixed(1)}×`} smaller)</>}
              {result.prominence.rule === "similar" && <>, similarly significant: all emphasised, summarised where they crowd</>}
              {result.prominence.rule === "single" && <>: the one finding is emphasised</>}
              .
            </p>
          )}
          {m !== "overview" && <button type="button" className="mt-2 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => onChange({ mode: "overview" })}>Clear filter</button>}
        </div>
      )}
    </div>
  );
}

type PanelProps = {
  result: FindingsResult;
  units: UnitSystem;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  labels?: { placed: number; emphasized: number } | null;
};

const PAGE = 50;

export function FindingsPanel({ result, units, selectedIndex, onSelect, onClose, labels }: PanelProps) {
  const [sort, setSort] = useState<SortKey>("rank");
  const [shown, setShown] = useState(PAGE);
  const F = result.findings;
  const order = useMemo(() => {
    const idx = F.map((_, i) => i);
    if (sort === "size") idx.sort((a, b) => sizeOf(F[b]) - sizeOf(F[a]));
    else if (sort === "confidence") idx.sort((a, b) => (F[b].score ?? -1) - (F[a].score ?? -1));
    else if (sort === "members") idx.sort((a, b) => (F[b].members ?? 0) - (F[a].members ?? 0));
    return idx;
  }, [F, sort]);
  const kind = F[0]?.kind;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">Findings</p>
          <p className="mt-0.5 text-base font-semibold text-neutral-100">{MODE_LABEL[result.query.mode]}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-[#262a26] hover:text-neutral-100" aria-label="Close the findings panel"><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-neutral-400">{result.note}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-neutral-400">
        <span><span className="text-neutral-100">{F.length.toLocaleString()}</span> result{F.length === 1 ? "" : "s"}{labels ? ` · ${labels.placed} of ${labels.emphasized} emphasised labelled at this zoom` : ""}</span>
        <label className="flex items-center gap-1">Sort
          <select value={sort} onChange={e => { setSort(e.target.value as SortKey); setShown(PAGE); }} className="rounded-sm border border-[#3a3f3a] bg-[#111311] px-1 py-0.5 text-[11px] text-neutral-100" aria-label="Sort results">
            <option value="rank">by rank</option>
            {kind !== "region" && <option value="size">by size</option>}
            {kind === "region" && <option value="size">by ground</option>}
            {kind !== "region" && <option value="confidence">by confidence</option>}
            {kind !== "weed" && <option value="members">by candidates</option>}
          </select>
        </label>
      </div>
      {F.length === 0 ? (
        <div className="mt-4 rounded-sm border border-dashed border-[#3a3f3a] p-3 text-xs text-neutral-400">
          <p className="font-semibold text-neutral-200">Nothing qualifies.</p>
          <p className="mt-1">No {kindWord(result.query.mode)} meets the threshold. {result.excluded.length ? "Not counted here: " + result.excluded.map(e => `${e.count.toLocaleString()} ${e.reason}`).join("; ") + "." : ""}</p>
        </div>
      ) : (
        <ol className="mt-2 min-h-0 flex-1 overflow-y-auto text-xs" aria-label="Findings">
          {order.slice(0, shown).map(i => {
            const f = F[i], emphasised = i < result.prominence.count, selected = i === selectedIndex;
            return (
              <li key={`${f.kind}-${f.id}`}>
                <button type="button" onClick={() => onSelect(i)} className={`flex w-full items-start gap-2 border-b border-[#262a26] px-1 py-1.5 text-left hover:bg-[#1f231f] ${selected ? "bg-[#262c26]" : ""}`} aria-pressed={selected}>
                  <span className="mt-0.5 w-6 shrink-0 text-right tabular-nums text-neutral-500">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-neutral-100">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: emphasised ? (f.kind === "region" ? TWIN_COLOURS.region : TWIN_COLOURS.finding) : "#4a4f4a" }} aria-label={emphasised ? "emphasised on the map" : "listed, not emphasised"} />
                      {f.kind === "region" ? `Region ${f.id}` : f.kind === "patch" ? `Patch ${f.id}` : `Weed ${f.id}`}
                      <span className="ml-auto tabular-nums text-neutral-200">{findingValueText(f, m2 => areaText(m2, units))}</span>
                    </span>
                    <span className="block text-[10px] leading-snug text-neutral-500">{detailLine(f, units)}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {shown < F.length && <li><button type="button" className="w-full py-2 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setShown(s => s + PAGE * 4)}>Show more ({(F.length - shown).toLocaleString()} more)</button></li>}
        </ol>
      )}
      {result.excluded.length > 0 && F.length > 0 && <p className="mt-2 text-[10px] leading-snug text-neutral-500">Not listed: {result.excluded.map(e => `${e.count.toLocaleString()} ${e.reason}`).join("; ")}.</p>}
    </div>
  );
}

function sizeOf(f: Finding): number { return f.weedAreaM2 ?? f.footprintM2 ?? f.affectedM2 ?? 0; }
function kindWord(mode: FindingMode): string { return mode === "clusters" ? "patch" : mode === "pressure" || mode === "extent" || mode === "overview" ? "region" : "candidate"; }

/** The second line of a result: the other metrics, each named, never mixed with the ranking value. */
export function detailLine(f: Finding, u: UnitSystem): string {
  const parts: string[] = [];
  if (f.kind === "weed") {
    if (f.valueOf !== "weed area m2") parts.push(`${areaText(f.weedAreaM2!, u)} cover`);
    if (f.consistency) parts.push(`seen in ${f.consistency.seenBy} of ${f.consistency.coveredBy}${f.consistency.seenBy >= 2 ? `, size agreed within ${Math.round(f.consistency.sizeCv * 100)} %` : ""}`);
    if (f.score != null && f.valueOf !== "model score") parts.push(`score ${Math.round(f.score * 100)} %`);
    if (f.rowStatus) parts.push(f.rowStatus);
  } else if (f.kind === "patch") {
    parts.push(`${f.members} candidates`, `summed cover ${areaText(f.coverM2!, u)}`);
    if (f.score != null) parts.push(`median score ${Math.round(f.score * 100)} %`);
    if (f.rowStatus) parts.push(f.rowStatus);
  } else {
    if (f.valueOf !== "affected ground m2") parts.push(`${fmtArea(f.affectedM2!, u).text} affected`);
    if (f.valueOf !== "cover % of observable ground") parts.push(`${f.coverPct!.toFixed(1)} % of observable ground`);
    parts.push(`${f.members} candidates`);
    if (f.uncertainty > 0) parts.push(`${Math.round(f.uncertainty * 100)} % seen once`);
  }
  return parts.join(" · ");
}
