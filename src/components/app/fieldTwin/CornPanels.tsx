// Corn twins in the Field Twin viewer: the left-column panel (what the corn read found over the field, its layers and
// a list of everything to review) and the inspector for a selected corn row, weed observation or stand gap (state,
// measurements, the photographs behind it, crops from them). Review-only throughout: a finding here is something to
// look at, never a treatment decision; observations the photographs do not confirm are listed and drawn apart, not
// dropped.
import { useMemo, useState } from "react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtAreaCm2, fmtDistance, fmtLengthCm } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";
import { TWIN_COLOURS, type TwinLayers } from "@/lib/fieldTwin/style";
import type { TwinBundle, TwinCorn, TwinCornGap, TwinCornRow, TwinCornWeed, TwinEvidence } from "@/lib/fieldTwin/types";
import { localFrame } from "@/lib/fieldTwin/intelligence";
import { CORN_WEED_LABEL, type CornFieldRowView, cornFieldRows, cornGapColour, cornRowColour, cornWeedColour, fieldRowOf, isLocalTwin } from "@/lib/fieldTwin/cornView";
import { CORN_RENDER, type CornViewMode, cornLookOf, cornPlantCount, isOnRow, plantsSorted, rgbCss } from "@/lib/fieldTwin/cornRender";
import { toWorld } from "@/lib/fieldTwin/scene";
import { type PlotContext, fieldStand, fmtAcres, fmtFt, fmtIn, fmtPct, fmtPerAcre, plotContext, readShareOf } from "@/lib/fieldTwin/plots";
import { WEED_PATCH_COLOUR, type WeedPatch, thinRows, weedPatches } from "@/lib/fieldTwin/cornPatches";
import { SIMPLE, averageColour, hslRgb } from "@/lib/fieldTwin/simpleView";
import EvidenceCrop from "./EvidenceCrop";
import type { TwinPick } from "./TwinCanvasLayer";

const panel = "rounded-md border border-[#343834] bg-[#171a17]";
const cm = (m: number, u: UnitSystem) => fmtLengthCm(m * 100, u).text;
type Line = { label: string; value: string };

const gapColour = cornGapColour, rowColour = cornRowColour;

const middle = (line: [number, number][]) => line[line.length >> 1];

type ListKey = "confirmedWeeds" | "otherWeeds" | "gaps" | "withheldGaps" | "rows";

/** A finding to fly to from "What to look at": its place, and how much ground to show round it. */
export type LookAt = { lat: number; lng: number; across: number; patch?: number };

const flown = (twin: TwinBundle) => {
  const c = twin.source.capturedAt;
  if (!c) return null;
  const v = Date.parse(c.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
  return Number.isFinite(v) ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
};

/**
 * The left-column cards for a corn twin (his brief of 2026-11-23, option A): the Stand (plants per acre first, over the
 * rows the photographs read), What to look at (weed patches, gaps, thin rows, each one a click to its place), a line on
 * the flight only when it limits the result, then Details, closed, with everything else. US units throughout. `plots`
 * goes between the flight line and Details (the founder's plot cards).
 */
export function CornFieldPanel({ twin, corn, layers, setLayers, onSelect, view, technical = false, plotCtx: ctxProp, patches: patchesProp, blockHa = null, onLookAt, activePatch = null, plots = null, weedsOutside = 0 }: {
  /** Marks of green that is not corn outside the field boundary in use: not shown, not in a patch. */ weedsOutside?: number;
  twin: TwinBundle; corn: TwinCorn; layers: TwinLayers; setLayers: (f: (l: TwinLayers) => TwinLayers) => void;
  onSelect: (p: TwinPick, lat: number, lng: number, metresAcross: number) => void;
  /** Kept for the callers; the corn panel speaks US units (his brief). */ units?: UnitSystem;
  /** The view on the map (its colours are the swatches here). */ view: CornViewMode;
  /** The founder's "All layers": the finer breakdown and the whole-layer switch. */ technical?: boolean;
  /** The plot context and weed patches the page already made (made here when absent). */ plotCtx?: PlotContext | null; patches?: WeedPatch[] | null;
  /** The field boundary's area, hectares. */ blockHa?: number | null;
  /** A weed patch chosen (the map flies to it and marks it); a gap or a row goes through onSelect. */ onLookAt?: (l: LookAt) => void; activePatch?: number | null;
  plots?: React.ReactNode;
}) {
  const s = corn.summary, U: UnitSystem = "imperial";
  const count = useMemo(() => cornPlantCount(corn), [corn]);
  const look = useMemo(() => cornLookOf(corn, toWorld), [corn]);
  const onRowCss = view === "simple" ? rgbCss(CORN_RENDER.simpleCorn) : rgbCss(look.corn), offRowCss = rgbCss(CORN_RENDER.offRow), notCornCss = rgbCss(CORN_RENDER.notCorn);
  const withheld = corn.notes.find(n => /plant count|per-plant count|count withheld/i.test(n)) ?? null;
  const fieldRows = useMemo(() => cornFieldRows(corn), [corn]);
  const plantsFirst = fieldRows.some(r => r.plantsFirst);
  const R = useMemo(() => ({ n: fieldRows.length, confirmedM: fieldRows.reduce((t, r) => t + r.confirmedM, 0), notConfirmedM: fieldRows.reduce((t, r) => t + r.notConfirmedM, 0), courseOnly: fieldRows.filter(r => r.confirmed === 0).length }), [fieldRows]);
  const P = corn.plants?.summary ?? null;
  const hidden = s.weeds.unconfirmed + s.weeds.contested + s.gaps.withheld;
  const ctx = useMemo(() => (ctxProp !== undefined ? ctxProp : plotContext(twin)), [ctxProp, twin]);
  const patches = useMemo(() => patchesProp ?? (ctx ? weedPatches(ctx) : []), [patchesProp, ctx]);
  const stand = useMemo(() => fieldStand(twin), [twin]);
  const span = useMemo(() => { if (!ctx) return null; const v = Array.from(ctx.pSpan).filter(x => !Number.isNaN(x)).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; }, [ctx]);
  const thin = useMemo(() => (ctx ? thinRows(ctx) : null), [ctx]);
  const [list, setList] = useState<ListKey>("confirmedWeeds");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [allPatches, setAllPatches] = useState(false);
  const late = corn.stage?.verdict === "late";
  const readShare = ctx?.readShare ?? readShareOf(corn.notes);
  const gapsLeftOut = ctx ? !ctx.gaps.measured : readShare != null;
  const gapsWhy = ctx && ctx.gaps.measured === false ? ctx.gaps.why : null;

  const items = useMemo(() => {
    const byArea = (a: TwinCornWeed, b: TwinCornWeed) => b.areaM2 - a.areaM2;
    if (list === "confirmedWeeds") return corn.weeds.filter(w => w.status === "confirmed").sort(byArea).map(w => ({ key: `w${w.id}`, colour: cornWeedColour(w.status), title: `Weed ${w.id}`, detail: `${fmtAreaCm2(w.areaM2 * 10_000, U).text}, a weed in ${w.votes.weed} of the ${w.seenBy} photographs that saw it`, pick: { kind: "cornWeed", id: w.id } as TwinPick, lat: w.lat, lng: w.lng, across: 2 }));
    if (list === "otherWeeds") return corn.weeds.filter(w => w.status !== "confirmed").sort(byArea).map(w => ({ key: `w${w.id}`, colour: cornWeedColour(w.status), title: `${w.status === "contested" ? "Contested" : "Unconfirmed"} ${w.id}`, detail: `${fmtAreaCm2(w.areaM2 * 10_000, U).text}, weed in ${w.votes.weed}, crop in ${w.votes.crop} of the ${w.seenBy} that saw it`, pick: { kind: "cornWeed", id: w.id } as TwinPick, lat: w.lat, lng: w.lng, across: 2 }));
    if (list === "gaps" || list === "withheldGaps") return corn.gaps.filter(g => (list === "gaps" ? g.status === "confirmed" : g.status === "withheld")).sort((a, b) => b.lengthM - a.lengthM).map(g => ({ key: `g${g.id}`, colour: gapColour(g.status), title: `Gap ${g.id}, row ${g.rowId}`, detail: `${cm(g.lengthM, U)}, reported by ${g.reportedBy.length}`, pick: { kind: "cornGap", id: g.id } as TwinPick, lat: (g.a[0] + g.b[0]) / 2, lng: (g.a[1] + g.b[1]) / 2, across: Math.max(3, g.lengthM * 2.5) }));
    return [...fieldRows].sort((a, b) => b.lengthM - a.lengthM).map(v => {
      const first = corn.rows[v.stretches.find(i => corn.rows[i].status === "corn") ?? v.stretches[0]], line = corn.rows[v.stretches[v.stretches.length >> 1]].line;
      return { key: `r${v.id}`, colour: v.confirmed ? TWIN_COLOURS.cornRow : TWIN_COLOURS.cornRowCourse, title: `Row ${v.id}${v.confirmed ? "" : v.plantsFirst ? ", no plant confirmed" : ", crop not confirmed"}`, detail: rowListDetail(v, U), pick: { kind: "cornRow", id: first.id } as TwinPick, lat: middle(line)[0], lng: middle(line)[1], across: Math.max(6, v.lengthM * 1.1) };
    });
  }, [list, corn, fieldRows, U]);
  const tab = (k: ListKey, label: string, n: number) => (
    <button key={k} type="button" onClick={() => setList(k)} aria-pressed={list === k} className={`rounded-[2px] px-1.5 py-0.5 text-[10px] ${list === k ? "bg-[#f0a63a] font-semibold text-[#171a18]" : "text-neutral-300 hover:bg-[#262a26]"}`}>{label} {n}</button>
  );
  const check = (k: "corn" | "cornUncertain", label: string, hint: string) => (
    <label className="flex items-start gap-2 py-0.5 text-[11px] text-neutral-200">
      <input type="checkbox" className="mt-0.5 accent-[#f0a63a]" checked={layers[k]} onChange={e => setLayers(l => ({ ...l, [k]: e.target.checked }))} />
      <span>{label}<span className="block text-[10px] leading-snug text-neutral-500">{hint}</span></span>
    </label>
  );
  const cap = (t: string) => <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{t}</span>;
  const go = <span className="ml-auto pl-1 text-[12px] text-[#f0a63a]" aria-hidden="true">›</span>;
  const date = flown(twin);

  // The flight, in one line, only when something limits the result.
  const limits: string[] = [];
  // In plain words (his wording, 2026-11-23), a sentence each.
  if (late) limits.push(`Plants can't be counted on this flight: the corn canopy has closed in ${corn.stage!.late} of the ${corn.stage!.looked} photos.`);
  if (!late && gapsLeftOut && readShare != null) limits.push("Gaps can't be measured on this flight: each photo covers too little of each row.");
  if (twin.source.groundPixelCm > 1) limits.push("Flown high: the smallest seedlings may be missed.");
  if (count && stand?.readShare != null && stand.readShare < 0.8) limits.push(`Plants were seen along only ${fmtPct(stand.readShare)} of the row.`);

  const spanIn = span != null ? Math.round(span / 0.0254) : null;
  const patchArea = patches.reduce((t, p) => t + p.areaM2, 0);
  const shownPatches = allPatches ? patches : patches.slice(0, 3);
  const confirmedWeeds = corn.weeds.filter(w => w.status === "confirmed");
  const confirmedGaps = corn.gaps.filter(g => g.status === "confirmed");

  return (
    <div className="flex w-[272px] flex-col gap-2 text-xs" role="group" aria-label="Corn">
      {/* The stand: plants per acre, over the rows the photographs read. */}
      <div className={`px-3 pb-2.5 pt-2.5 ${panel}`} role="group" aria-label="Stand">
        <div className="flex items-baseline justify-between gap-2">{cap("Stand")}<span className="truncate text-[10.5px] text-neutral-500">{[twin.name, date ? `flown ${date}` : null].filter(Boolean).join(" · ")}</span></div>
        {isLocalTwin(twin) && <p className="mt-1 text-[10px] leading-snug text-amber-300/90">Test flight, locally aligned: positions are relative to each other and the scale is estimated from the corn rows. Not a place on the map.</p>}
        {count && stand?.perAcre != null ? <>
          <div className="mt-2 flex items-baseline gap-2"><span className="text-[32px] font-bold leading-none tracking-tight tabular-nums text-neutral-50">{fmtPerAcre(stand.perAcre)}</span><span className="text-[13px] text-neutral-300">plants / acre</span></div>
          <p className="mt-1 text-[10.5px] text-neutral-400">over the {fmtFt(stand.seenM)} of row with plants seen ({fmtAcres(stand.seenM * stand.spacingM)})</p>
        </> : (
          <div className="mt-2"><div className="flex items-baseline justify-between gap-2"><span className="text-[11px] text-neutral-300">Plants counted</span><span className="text-[11px] font-semibold text-neutral-200">not counted on this flight</span></div>
            <p className="mt-1 text-[10px] leading-snug text-neutral-500">{late ? `The corn canopy has closed in ${corn.stage!.late} of the ${corn.stage!.looked} photographs, so plants cannot be told apart. The rows are drawn as bands instead of single plants.` : withheld ?? "The photographs gave no plant-by-plant count here (plants too large to tell apart, or no row of plants found). The rows are drawn as bands instead of single plants."}</p></div>
        )}
        <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-[11.5px]">
          {count && <><dt className="text-neutral-400">Plants counted</dt><dd className="text-right tabular-nums text-neutral-100">{count.total.toLocaleString("en-US")}</dd></>}
          <dt className="text-neutral-400">Stage</dt><dd className="text-right text-neutral-100">{late ? "Late, canopy closing" : count ? `Emergence${spanIn ? ` · ~${spanIn} in tip to tip` : ""}` : "–"}</dd>
          <dt className="text-neutral-400">Row spacing</dt><dd className="text-right tabular-nums text-neutral-100">{corn.rowSpacingM != null ? `${fmtIn(corn.rowSpacingM)}${isLocalTwin(twin) ? " (estimated)" : ""}` : "–"}</dd>
          {count && stand?.readShare != null && <><dt className="text-neutral-400">Rows read in the photos</dt><dd className="text-right tabular-nums text-neutral-100">{fmtPct(stand.readShare)}</dd></>}
          {blockHa != null && <><dt className="text-neutral-400">Field</dt><dd className="text-right tabular-nums text-neutral-100">{fmtAcres(blockHa * 10_000)}</dd></>}
        </dl>
      </div>

      {/* What to look at: each one a click to its place on the map. */}
      <div className={`px-1.5 pb-2 pt-2.5 ${panel}`} role="group" aria-label="What to look at">
        <div className="px-1.5 pb-1">{cap("What to look at")}</div>
        {ctx && <>
          <div className="flex items-baseline justify-between gap-2 px-1.5 py-0.5 text-[11.5px]"><span className="text-neutral-200">Weed patches <span className="text-neutral-500">(unconfirmed)</span></span><span className="tabular-nums text-neutral-100">{patches.length ? `${patches.length} · ${fmtAcres(patchArea)}` : "None"}</span></div>
          {shownPatches.map(p => (
            <button key={p.number} type="button" className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11.5px] text-neutral-200 hover:bg-[#232723] ${activePatch === p.number ? "bg-[#232723]" : ""}`}
              onClick={() => onLookAt?.({ lat: p.lat, lng: p.lng, across: Math.max(6, Math.sqrt(p.areaM2) * 2.2), patch: p.number })} aria-label={`Weed patch ${p.number}: ${fmtAcres(p.areaM2)}, ${p.where}`}>
              <span className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-extrabold text-[#1b1d1b] ${activePatch === p.number ? "ring-2 ring-white" : ""}`} style={{ background: WEED_PATCH_COLOUR }}>{p.number}</span>
              <span>{fmtAcres(p.areaM2)} · {p.where}</span>{go}
            </button>
          ))}
          {patches.length > 3 && <button type="button" className="px-2 pb-1 text-[10.5px] text-neutral-500 hover:text-neutral-300" onClick={() => setAllPatches(o => !o)}>{allPatches ? "Show the largest 3" : `+ ${patches.length - 3} smaller · show all`}</button>}
          {patches.length > 0 && <p className="px-2 pb-1 text-[10px] leading-snug text-neutral-500">Where the green that is not corn stands thick: often weeds, sometimes dark ground or shadow.</p>}
          {weedsOutside > 0 && <p className="px-2 pb-1 text-[10px] leading-snug text-neutral-500">Inside the field boundary only: {weedsOutside.toLocaleString()} green marks outside it are not shown.</p>}
        </>}
        {confirmedWeeds.length > 0 && <div className="mx-1.5 mt-1 border-t border-[#262a26] pt-1.5">
          <div className="flex items-baseline justify-between text-[11.5px]"><span className="text-neutral-200">Weed candidates, confirmed</span><span className="tabular-nums text-neutral-100">{confirmedWeeds.length}</span></div>
          {confirmedWeeds.slice(0, 3).map(w => <button key={w.id} type="button" className="flex w-full items-center gap-2 rounded-sm px-0.5 py-1 text-left text-[11px] text-neutral-300 hover:bg-[#232723]" onClick={() => onSelect({ kind: "cornWeed", id: w.id }, w.lat, w.lng, 2)}><span className="inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornWeed }} />Weed {w.id} · {fmtAreaCm2(w.areaM2 * 10_000, U).text}{go}</button>)}
        </div>}
        <div className="mx-1.5 mt-1 border-t border-[#262a26] pt-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[11.5px]"><span className="text-neutral-200">Gaps in the stand</span><span className={gapsLeftOut ? "text-right text-neutral-400" : "tabular-nums text-neutral-100"}>{gapsLeftOut ? "Not measured on this flight" : confirmedGaps.length ? `${confirmedGaps.length} · ${fmtFt(confirmedGaps.reduce((t, g) => t + g.lengthM, 0))}` : "None"}</span></div>
          {gapsLeftOut && <p className="mt-0.5 text-[10.5px] leading-snug text-neutral-500">{gapsWhy ?? "A missing plant can't be told from one the photos missed."}</p>}
          {!gapsLeftOut && confirmedGaps.slice(0, 3).map(g => <button key={g.id} type="button" className="flex w-full items-center gap-2 rounded-sm px-0.5 py-1 text-left text-[11px] text-neutral-300 hover:bg-[#232723]" onClick={() => onSelect({ kind: "cornGap", id: g.id }, (g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2, Math.max(3, g.lengthM * 2.5))}><span className="inline-block h-1 w-3" style={{ background: TWIN_COLOURS.cornGap }} />Row {g.rowId} · {fmtIn(g.lengthM, 0)}{go}</button>)}
        </div>
        {thin && thin.medianPerM != null && <div className="mx-1.5 mt-1.5 border-t border-[#262a26] pt-1.5">
          <div className="flex items-baseline justify-between text-[11.5px]"><span className="text-neutral-200">Thin rows</span><span className={thin.rows.length ? "tabular-nums text-neutral-100" : "text-neutral-400"}>{thin.rows.length || "None"}</span></div>
          {thin.rows.length === 0 && thin.lowestShare != null && <p className="mt-0.5 text-[10.5px] leading-snug text-neutral-500">The thinnest row holds {fmtPct(thin.lowestShare)} of the median row's {(thin.medianPerM * 3.048).toFixed(1)} plants per 10 ft.</p>}
          {thin.rows.map(r => { const v = fieldRows.find(x => x.id === r.row); const first = v ? corn.rows[v.stretches.find(i => corn.rows[i].status === "corn") ?? v.stretches[0]] : null; return (
            <button key={r.row} type="button" className="flex w-full items-center gap-2 rounded-sm px-0.5 py-1 text-left text-[11px] text-neutral-300 hover:bg-[#232723]" onClick={() => { if (first) onSelect({ kind: "cornRow", id: first.id }, r.lat, r.lng, Math.max(6, r.lengthM * 1.1)); }}>
              <span className="inline-block h-0.5 w-3" style={{ background: TWIN_COLOURS.cornRow }} />Row {r.row} · {(r.perM * 3.048).toFixed(1)} plants per 10 ft{go}</button>); })}
          {thin.rows.length > 0 && <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">Under 70 % of the median row's {(thin.medianPerM * 3.048).toFixed(1)} plants per 10 ft of row with plants seen.</p>}
        </div>}
      </div>

      {limits.length > 0 && <div className="flex gap-1.5 rounded border border-[#6b4f1d] bg-[#2b2110] px-2.5 py-1.5 text-[11px] leading-snug text-[#f3c97a]" role="note" aria-label="Flight"><span aria-hidden="true">⚠</span><span>{limits.join(" ")}</span></div>}

      {plots}

      {/* Everything else, closed. */}
      <div className={`px-3 py-2 ${panel}`} role="group" aria-label="Details">
        <button type="button" className="flex w-full items-center justify-between text-left text-[11.5px] text-neutral-100" onClick={() => setDetailsOpen(o => !o)} aria-expanded={detailsOpen}><span>Details</span><span className="text-[11px] text-neutral-500" aria-hidden="true">{detailsOpen ? "▾" : "▸"}</span></button>
        {!detailsOpen && <p className="mt-0.5 text-[10px] text-neutral-500">How it was counted, weed candidates, rows, notes</p>}
        {detailsOpen && <>
          <p className="mt-1.5 text-[10px] leading-snug text-neutral-400">Every photograph read by Corn V1, combined over the field ({corn.photographs.read} photographs). The crop is your entry.</p>
          {count && (
            <div className="mt-1.5 rounded-sm border border-[#2e322e] bg-[#111311] px-2 py-1.5" role="group" aria-label="Plant count">
              <div className="flex items-baseline justify-between"><span className="text-[11px] text-neutral-300">Plants counted</span><span className="text-sm font-semibold tabular-nums text-neutral-50">{count.total.toLocaleString()}</span></div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                <dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: onRowCss }} />On the rows</dt><dd className="text-right tabular-nums text-neutral-100">{count.onRows.toLocaleString()}</dd>
                {!count.sorted && <><dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: offRowCss }} />Off the rows</dt><dd className="text-right tabular-nums text-neutral-100">{count.offRows.toLocaleString()}</dd></>}
              </dl>
              {count.sorted ? <>
                <div className="mt-1 flex items-baseline justify-between border-t border-[#262a26] pt-1 text-[11px]"><span className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: notCornCss }} />Green, not corn (not counted)</span><span className="tabular-nums text-neutral-300">{count.notCorn.toLocaleString()}</span></div>
                {technical && <div className="mt-0.5 flex items-baseline justify-between text-[11px]"><span className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: offRowCss }} />Doubles (not counted)</span><span className="tabular-nums text-neutral-300">{count.doubles.toLocaleString()}</span></div>}
                <p className="mt-1 text-[10px] leading-snug text-neutral-500">Counted: the plants on the rows. A mark on a row very close to a plant already counted there is left out (mostly the same plant seen twice){technical ? "; with All layers these doubles are drawn in blue" : ""}. Green off the rows (between rows, past the rows' ends, beyond the outer rows) is not corn and is not counted{count.betweenRows ? `; ${count.betweenRows.toLocaleString()} of it stands between two rows` : ""}.</p>
              </> : <p className="mt-1 text-[10px] leading-snug text-neutral-500">Every plant two or more photographs located is counted. Plants off the rows are counted too and drawn in their own colour{count.betweenRows ? ` (${count.betweenRows.toLocaleString()} of them stand between two rows)` : ""}. Built before plants off the rows were sorted: building it again counts the corn only.</p>}
              {stand?.perAcre != null && stand.lowerPerAcre != null && <p className="mt-1 border-t border-[#262a26] pt-1 text-[10px] leading-snug text-neutral-500">Plants per acre: the plants counted ÷ (the {fmtFt(stand.seenM)} of row with plants seen × the {fmtIn(stand.spacingM)} row spacing). If every stretch with no plant confirmed ({fmtFt(stand.notSeenM)}) were a real gap, it would be {fmtPerAcre(stand.lowerPerAcre)} per acre.</p>}
            </div>
          )}
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-neutral-400">Rows</dt><dd className="text-right tabular-nums text-neutral-100">{R.n}{R.courseOnly ? ` (${R.courseOnly} ${plantsFirst ? "with no plant confirmed" : "crop not confirmed"})` : ""}</dd>
            <dt className="text-neutral-400"><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: TWIN_COLOURS.cornRow }} />{plantsFirst ? "Plants seen along" : "Corn rows"}</dt><dd className="text-right tabular-nums text-neutral-100">{fmtFt(R.confirmedM)}</dd>
            <dt className="text-neutral-400"><span className="mr-1 inline-block h-px w-3 align-middle" style={{ background: TWIN_COLOURS.cornRowCourse }} />{plantsFirst ? "No plant confirmed" : "Crop not confirmed"}</dt><dd className="text-right tabular-nums text-neutral-100">{fmtFt(R.notConfirmedM)}</dd>
            {technical && P && <><dt className="text-neutral-500">Seen by most photographs / probable</dt><dd className="text-right tabular-nums text-neutral-300">{P.certain.toLocaleString()} / {P.probable.toLocaleString()}</dd></>}
            {technical && P?.alongRowsTwo != null && <><dt className="text-neutral-500">Second look along rows (2+ / 1 view)</dt><dd className="text-right tabular-nums text-neutral-300">{P.alongRowsTwo.toLocaleString()} / {(P.alongRowsOne ?? 0).toLocaleString()}</dd></>}
            {technical && P && <><dt className="text-neutral-500">On no row / between rows</dt><dd className="text-right tabular-nums text-neutral-300">{P.onNoRow.toLocaleString()} / {P.betweenRows.toLocaleString()}</dd></>}
            <dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornWeed }} />Weeds, confirmed</dt><dd className="text-right tabular-nums text-neutral-100">{s.weeds.confirmed}</dd>
            <dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornWeedUnconfirmed }} />Not confirmed / contested</dt><dd className="text-right tabular-nums text-neutral-100">{s.weeds.unconfirmed} / {s.weeds.contested}</dd>
            {!gapsLeftOut && <><dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornGap }} />Stand gaps</dt><dd className="text-right tabular-nums text-neutral-100">{s.gaps.confirmed} ({fmtFt(s.gaps.confirmedLengthM)})</dd></>}
            {!gapsLeftOut && <><dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornGapWithheld }} />Gaps withheld</dt><dd className="text-right tabular-nums text-neutral-100">{s.gaps.withheld}</dd></>}
            <dt className="text-neutral-400">Photographs agree on rows</dt><dd className="text-right tabular-nums text-neutral-100">{corn.rowAgreementM != null ? `within ${cm(corn.rowAgreementM, U)}` : "–"}</dd>
          </dl>
          {/* What the field combination left out or withheld, in its own words (its review-only note is the line below). */}
          {corn.notes.some(n => !/^Review-only/.test(n)) && <ul className="mt-1.5 space-y-1 border-l border-[#2e322e] pl-2 text-[10px] leading-snug text-neutral-400" aria-label="Notes on this flight">{corn.notes.filter(n => !/^Review-only/.test(n)).map(n => <li key={n}>{n}</li>)}</ul>}
          <div className="mt-1.5 border-t border-[#2e322e] pt-1">
            {technical && check("corn", "Corn layer", "everything the corn read found: plants, rows, weeds and gaps")}
            {check("cornUncertain", `Observations not confirmed${hidden ? ` (${hidden.toLocaleString()})` : ""}`, "weed candidates not repeated or contested, gaps withheld: kept for review, never findings")}
          </div>
          <div className="mt-1.5 border-t border-[#2e322e] pt-1.5">
            <div className="flex flex-wrap gap-0.5">
              {tab("confirmedWeeds", "Weeds", s.weeds.confirmed)}
              {tab("otherWeeds", "Unconfirmed", s.weeds.unconfirmed + s.weeds.contested)}
              {!gapsLeftOut && tab("gaps", "Gaps", s.gaps.confirmed)}
              {!gapsLeftOut && tab("withheldGaps", "Withheld", s.gaps.withheld)}
              {tab("rows", "Rows", fieldRows.length)}
            </div>
            <ul className="mt-1 max-h-48 overflow-y-auto" aria-label="Corn findings to review">
              {items.length === 0 && <li className="py-1 text-[10px] text-neutral-500">None.</li>}
              {items.map(it => (
                <li key={it.key}><button type="button" className="flex w-full items-start gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-[#262a26]" onClick={() => onSelect(it.pick, it.lat, it.lng, it.across)}>
                  <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: it.colour }} />
                  <span className="text-[11px] text-neutral-200">{it.title}<span className="block text-[10px] text-neutral-500">{it.detail}</span></span>
                </button></li>
              ))}
            </ul>
          </div>
        </>}
        <p className="mt-1.5 border-t border-[#262a26] pt-1.5 text-[10px] leading-snug text-neutral-500">Review-only: for checking in the field, not a treatment decision.</p>
      </div>
    </div>
  );
}

/** The list line for a field row: its length, and what the photographs hold along it. */
function rowListDetail(v: CornFieldRowView, units: UnitSystem): string {
  const L = fmtDistance(v.lengthM, units).text;
  if (!v.plantsFirst) return v.confirmed ? L : `${L}, crop not confirmed`;
  const seen = v.confirmed ? `plants seen along ${fmtDistance(v.confirmedM, units).text}` : "no plant confirmed";
  return `${L}, ${seen}${v.plants != null ? `, ${v.plants} plants` : ""}`;
}

/** What each mark on a corn twin means, for everyone (the key): only what is drawn now. */
export function CornLegend({ corn, showPlants, uncertain, overPhotos = false, view = null, sampled = false, doubles = false, notRead = false }: { /** The Simple view: some stretch of row lies under fewer than two photographs (simpleView.ts unreadRows). */ notRead?: boolean; corn: TwinCorn; showPlants: boolean; uncertain: boolean; overPhotos?: boolean; /** The view on the map; null: rows and plant marks together (the row editor, or over the photographs). */ view?: CornViewMode | null; /** Whether the Realistic colours are this field's own. */ sampled?: boolean; /** The founder's "All layers": a sorted twin's doubles are drawn. */ doubles?: boolean }) {
  const plantsFirst = useMemo(() => cornFieldRows(corn).some(r => r.plantsFirst), [corn]);
  const look = useMemo(() => cornLookOf(corn, toWorld), [corn]);
  const item = (key: string, swatch: React.ReactNode, text: string) => <span key={key} className="flex items-center gap-1.5">{swatch}{text}</span>;
  const line = (colour: string, h: number, dash = false) => <span className="inline-block w-4 shrink-0" style={{ height: h, background: dash ? `repeating-linear-gradient(90deg, ${colour} 0 3px, transparent 3px 6px)` : colour }} />;
  const dot = (fill: string | null, stroke: string) => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: fill ?? "transparent", border: `1.5px solid ${stroke}` }} />;
  const weedItems = [
    item("w1", dot("rgba(239,83,80,0.35)", TWIN_COLOURS.cornWeed), "Weed candidate, confirmed"),
    uncertain && item("w2", dot(null, TWIN_COLOURS.cornWeedUnconfirmed), "Weed candidate, not confirmed"),
    uncertain && item("w3", dot(null, TWIN_COLOURS.cornWeedContested), "Contested: crop or weed"),
  ];
  // Stand gaps are reported only on a twin whose rows came from the photographs' lattice (none from located plants yet).
  const gapItems = corn.gaps.length ? [
    item("g1", line(TWIN_COLOURS.cornGap, 4), "Stand gap, confirmed"),
    uncertain && item("g2", line(TWIN_COLOURS.cornGapWithheld, 2, true), "Gap withheld"),
  ] : [];
  const unseen = item("unseen", <span className="inline-block h-2.5 w-3.5 shrink-0 rounded-sm border border-[#3a3f3a]" style={{ background: `repeating-linear-gradient(135deg, ${TWIN_COLOURS.hatch} 0 1px, ${TWIN_COLOURS.imagery} 1px 4px)` }} />, "Not photographed");
  const wrap = (list: React.ReactNode[]) => <div className="mt-1.5 grid grid-cols-1 gap-y-0.5 text-[10px] text-neutral-400 sm:grid-cols-2 sm:gap-x-3" aria-label="Corn legend">{list.filter(Boolean)}</div>;
  // Simple (his sketch of 2026-11-23): white rows, a box a plant, red boxes for the possible weeds; what the box's
  // size and colour mean, and that the colours are stretched.
  if (view === "simple" && corn.plants) {
    const box = (fill: string, edge: string | null = null, px = 9) => <span className="inline-block shrink-0" style={{ width: px, height: px, background: fill, border: edge ? `1px solid ${edge}` : undefined }} />;
    const avg = rgbCss(averageColour()), paler = rgbCss(hslRgb(SIMPLE.hue, SIMPLE.sat, SIMPLE.light + 0.24)), yellower = rgbCss(hslRgb(58, SIMPLE.sat, SIMPLE.light)), red = rgbCss(SIMPLE.weed);
    const measured = !!corn.plants.look, sorted = plantsSorted(corn.plants);
    return <>
      {wrap([
        item("row", line(SIMPLE.row, 1), "Row"),
        corn.rows.some(r => r.status !== "corn") && item("row0", line("rgba(255,255,255,0.35)", 1), "Row, no plants found (the photos saw this ground)"),
        notRead && item("row?", line(SIMPLE.unread, 2, true), "Row the photos couldn't read (fewer than two photos saw it)"),
        item("corn", <span className="flex shrink-0 items-end gap-0.5">{box(avg, null, 9)}{box(avg, null, 6)}</span>, measured ? "Corn plant: the box's size is its measured span" : "Corn plant"),
        measured && item("pale", <span className="flex shrink-0 gap-0.5">{box(paler)}{box(yellower)}</span>, "Paler, or yellower, than this field's average"),
        item("none", box(rgbCss(SIMPLE.neutral)), measured ? "No colour or size measured" : "Built before each plant's colour and size were measured"),
        sorted ? item("weed", box(red), "Possible weed (green that is not corn, unconfirmed)") : item("off", box(rgbCss(CORN_RENDER.offRow)), "Plant off the rows (counted)"),
        sorted && doubles && item("double", box(rgbCss(CORN_RENDER.offRow)), "Double: very close to a plant on its row (not counted)"),
        item("w1", box(red, "#ffffff"), "Weed candidate, confirmed"),
        ...gapItems,
        item("edge", <span className="inline-block h-2.5 w-3.5 shrink-0 border border-[#6a6f6a]" />, "Edge of the photographed ground"),
      ])}
      {measured && <p className="mt-1 text-[10px] leading-snug text-neutral-400">Colours are stretched to show differences between plants: this field's average plant is drawn in one green, a paler plant lighter, a yellower one more yellow.</p>}
      <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">Zoomed out, each row is a bar in its plants' average colour, fainter where the row is thinner.</p>
    </>;
  }
  // Realistic and Simple: the plants (or, with no plants located, the rows as bands), the weeds, the ground.
  if (view === "realistic" || view === "simple") {
    const cornCss = view === "simple" ? rgbCss(CORN_RENDER.simpleCorn) : rgbCss(look.corn), hasPlants = !!corn.plants, sorted = plantsSorted(corn.plants);
    return wrap([
      hasPlants ? item("corn", dot(cornCss, cornCss), "Corn plant, on a row") : item("band", line(cornCss, 4), "Corn row (plants not counted one by one)"),
      hasPlants && (!sorted || doubles) && item("off", dot(rgbCss(CORN_RENDER.offRow), rgbCss(CORN_RENDER.offRow)), sorted ? "Double: very close to a plant on its row (not counted)" : "Plant off the rows (counted)"),
      hasPlants && sorted && item("notcorn", <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: rgbCss(CORN_RENDER.notCorn) }} />, "Green, not corn (not counted)"),
      !hasPlants && item("course", line(TWIN_COLOURS.cornRowCourse, 1), "Row, crop not confirmed"),
      ...weedItems,
      ...gapItems,
      view === "realistic" && item("soil", <span className="inline-block h-2.5 w-3.5 shrink-0 rounded-sm" style={{ background: rgbCss(look.soil) }} />, sampled ? "Soil, in this field's own colour" : "Soil, in a standard colour"),
      unseen,
    ]);
  }
  // Geometry: the rows and the weeds.
  if (view === "geometry") return wrap([
    item("row", line(TWIN_COLOURS.cornRow, 3), plantsFirst ? "Row, plants seen along it" : "Corn row"),
    item("course", line(TWIN_COLOURS.cornRowCourse, 1), plantsFirst ? "Row continues, no plant confirmed" : "Row, crop not confirmed"),
    doubles && plantsSorted(corn.plants) && item("off", dot(rgbCss(CORN_RENDER.offRow), "#141614"), "Double: very close to a plant on its row (not counted; zoom in)"),
    ...weedItems,
    ...gapItems,
    unseen,
  ]);
  const items = [
    item("row", line(TWIN_COLOURS.cornRow, 3), plantsFirst ? "Row, plants seen along it" : "Corn row"),
    item("course", line(TWIN_COLOURS.cornRowCourse, 1), plantsFirst ? "Row continues, no plant confirmed" : "Row, crop not confirmed"),
    // Over the photographs, up close, plants are rings so the seedling under each shows: a bold ring and a faint dashed one.
    showPlants && item("p0", overPhotos ? <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ border: `2px solid ${TWIN_COLOURS.plantLocated}` }} /> : dot(TWIN_COLOURS.plantLocated, "#141614"), overPhotos ? "Plant, seen by most photographs over it (bold ring up close)" : "Plant, seen by most photographs over it"),
    showPlants && item("p1", overPhotos ? <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full opacity-60" style={{ border: `1px dashed ${TWIN_COLOURS.plantLocated}` }} /> : dot(null, TWIN_COLOURS.plantLocated), overPhotos ? "Plant, probable (faint dashed ring up close)" : "Plant, probable (on a row, at the spacing)"),
    showPlants && corn.plants?.summary.alongRowsTwo != null && item("p4", dot(null, TWIN_COLOURS.plantAlongRowTwo), "Plant found on a second look along a row (two or more photographs), probable"),
    showPlants && corn.plants?.summary.alongRowsTwo != null && item("p5", dot(null, TWIN_COLOURS.plantAlongRowOne), "Plant found on a second look along a row (one photograph's sharp view), probable"),
    showPlants && uncertain && item("p2", dot("#8c929a", "#8c929a"), plantsSorted(corn.plants) ? "Seen on no row: a double, or green that is not corn" : "Plant seen on no row"),
    showPlants && uncertain && item("p3", <span className="inline-block w-2 shrink-0 text-center leading-none text-[#8c929a]">×</span>, "Green between two rows, not the crop"),
    item("w1", dot("rgba(239,83,80,0.35)", TWIN_COLOURS.cornWeed), "Weed candidate, confirmed"),
    uncertain && item("w2", dot(null, TWIN_COLOURS.cornWeedUnconfirmed), "Weed candidate, not confirmed"),
    uncertain && item("w3", dot(null, TWIN_COLOURS.cornWeedContested), "Contested: crop or weed"),
    item("g1", line(TWIN_COLOURS.cornGap, 4), "Stand gap, confirmed"),
    uncertain && item("g2", line(TWIN_COLOURS.cornGapWithheld, 2, true), "Gap withheld"),
    overPhotos
      ? item("unseen", <span className="inline-block h-2.5 w-3.5 shrink-0 rounded-sm border border-[#3a3f3a]" style={{ background: "#1a1c1a" }} />, "Dark: not photographed")
      : item("unseen", <span className="inline-block h-2.5 w-3.5 shrink-0 rounded-sm border border-[#3a3f3a]" style={{ background: `repeating-linear-gradient(135deg, ${TWIN_COLOURS.hatch} 0 1px, ${TWIN_COLOURS.imagery} 1px 4px)` }} />, "Not photographed"),
    overPhotos && item("photos", <span className="inline-block h-2.5 w-3.5 shrink-0 rounded-sm" style={{ background: "linear-gradient(135deg,#6b5a45,#7a8a5a)" }} />, "Under the marks: the flight's photographs, as they show the ground"),
  ];
  return wrap(items);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-3 border-t border-[#2e322e] pt-3"><h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{title}</h3>{children}</section>;
}
const Rows = ({ lines }: { lines: Line[] }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">{lines.map(l => (<div key={l.label} className="contents"><dt className="text-neutral-400">{l.label}</dt><dd className="text-right tabular-nums text-neutral-100">{l.value}</dd></div>))}</dl>
);
function Header({ kind, title, colour, onClose }: { kind: string; title: string; colour: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{kind}</p>
        <p className="mt-0.5 flex items-center gap-2 text-base font-semibold text-neutral-100"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colour }} />{title}</p>
      </div>
      <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-[#262a26] hover:text-neutral-100" aria-label="Close the inspector">×</button>
    </div>
  );
}
function Evidence({ evidence, atlasUrl, colour, units }: { evidence: TwinEvidence[]; atlasUrl: (i: number) => Promise<string>; colour: string; units: UnitSystem }) {
  const [big, setBig] = useState<number | null>(null);
  if (!evidence?.length) return <p className="text-[11px] text-neutral-500">No photograph crops were kept for this object.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {evidence.map((e, i) => (
        <button key={i} type="button" className="text-left" onClick={() => setBig(big === i ? null : i)} aria-label={`Crop of ${e.photo}`}>
          <EvidenceCrop evidence={e} atlasUrl={atlasUrl} colour={colour} px={big === i ? 300 : 146} caption={`${e.photo}${e.metresAcross != null ? ` · ${fmtDistance(e.metresAcross, units).text} across` : ""}`} />
        </button>
      ))}
    </div>
  );
}
/** A reason as a sentence (nothing when the bundle carries none). */
const sentence = (why: string | undefined) => (why ? `${why[0].toUpperCase()}${why.slice(1)}.` : "");
const ReviewOnly = () => <p className="mt-3 text-[10px] leading-snug text-neutral-500">The crop is the operator's entry; nothing here tells corn from another row crop by its look.</p>;

/** Distance from a point to the nearest corn row, metres. */
function nearestCornRowM(twin: TwinBundle, corn: TwinCorn, lat: number, lng: number): { id: number; d: number } | null {
  const f = localFrame(twin), [px, py] = f.toLocal(lat, lng);
  let best: { id: number; d: number } | null = null;
  for (const r of corn.rows) {
    if (r.status !== "corn") continue;
    for (let i = 1; i < r.line.length; i++) {
      const a = f.toLocal(...r.line[i - 1]), b = f.toLocal(...r.line[i]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
      const d = Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
      if (!best || d < best.d) best = { id: r.id, d };
    }
  }
  return best;
}

/** The plants as drawn: positions, what each is drawn as, how many photographs located it (when known). */
export type CornPlantsShown = { points: [number, number][]; certainty?: number[] | null; photos?: number[] | null };

const PLANT_CLASS: Record<number, { title: string; text: string }> = {
  0: { title: "Plant on a row", text: "A plant two or more photographs located, on a row, seen by most of the photographs over it." },
  1: { title: "Plant on a row, probable", text: "A plant two or more photographs located, on a row at the field's plant spacing, but seen by fewer than most of the photographs over it." },
  2: { title: "Plant off the rows", text: "A plant two or more photographs located that stands on no row the twin drew: counted, and drawn in its own colour. Most are corn where no row was drawn (a headland, a row the twin missed); some may be weeds: the twin does not say which." },
  7: { title: "Double: on a row, very close to a plant", text: "Two or more photographs located it on a row's line, closer than half the plant spacing to a plant already on that row: the same plant seen twice, or two plants close together (on photo 0025 mostly the same plant). Not counted; drawn in blue only with All layers, so its photographs can be checked." },
  3: { title: "Plant between two rows", text: "A plant two or more photographs located between two rows: counted, and drawn in the off-row colour. By where it stands it may not be the crop." },
  4: { title: "Plant on a row, second look", text: "Two or more photographs marked it on a second look along a row the plants found first made; at the field's plant spacing. Probable." },
  5: { title: "Plant on a row, second look, one sharp view", text: "One photograph marked it on a second look along a row, near the middle of its frame where it sees sharply; at the field's plant spacing. Probable." },
};

const NOT_CORN_CLASS: Record<2 | 3, { title: string; text: string }> = {
  2: { title: "Green, not corn", text: "Green two or more photographs located on no row: past the rows' ends, beyond the outer rows, or on ground with no row pattern. Not corn, and not counted; often a weed, sometimes dark ground or a shadow: the twin does not say which." },
  3: { title: "Green between two rows, not corn", text: "Green two or more photographs located between two rows, on neither. Not corn, and not counted; often a weed, sometimes dark ground or a shadow: the twin does not say which." },
};

/** The inspector for a corn selection, or null when the selection is not corn. */
export function CornInspector({ twin, selection, atlasUrl, onClose, plants = null }: { twin: TwinBundle; selection: TwinPick; atlasUrl: (i: number) => Promise<string>; onClose: () => void; plants?: CornPlantsShown | null }) {
  const units = useUnitSystem();
  const corn = twin.corn;
  if (!corn || !selection) return null;
  if (selection.kind === "plant") {
    const c = plants?.certainty?.[selection.index] ?? 0, n = plants?.photos?.[selection.index] ?? null;
    // A sorted twin (cornRender.ts plantsSorted): its other plants off the rows are green that is not corn.
    const cls = plantsSorted(corn.plants) && (c === 2 || c === 3) ? NOT_CORN_CLASS[c] : PLANT_CLASS[c] ?? PLANT_CLASS[0];
    return (
      <div>
        <Header kind="Corn field" title={cls.title} colour={TWIN_COLOURS.plantLocated} onClose={onClose} />
        <p className="mt-2 text-xs text-neutral-300">{cls.text}</p>
        <Section title="What the photographs said"><Rows lines={[
          ...(n != null ? [{ label: "Located in", value: `${n} photograph${n === 1 ? "" : "s"}` }] : []),
          { label: "Position", value: isLocalTwin(twin) ? "local (test flight)" : `${selection.lat.toFixed(7)}, ${selection.lng.toFixed(7)}` },
        ]} /><p className="mt-1.5 text-[10px] text-neutral-500">{!plantsSorted(corn.plants) ? "Located by the photographs and counted in the field's plant count. Nothing in a photograph tells corn from another seedling by its look; a plant off the rows is counted like the rest and drawn in its own colour." : isOnRow(c) ? "Located by the photographs and counted in the field's plant count." : "Located by the photographs; not counted in the field's plant count."}</p></Section>
        <ReviewOnly />
      </div>
    );
  }
  if (selection.kind === "cornWeed") {
    const w = corn.weeds.find(x => x.id === selection.id);
    if (!w) return <p className="text-xs text-neutral-500">That observation is not in this twin.</p>;
    const near = nearestCornRowM(twin, corn, w.lat, w.lng);
    return (
      <div>
        <Header kind="Corn field" title={CORN_WEED_LABEL[w.status]} colour={cornWeedColour(w.status)} onClose={onClose} />
        <p className="mt-2 text-xs text-neutral-300">{sentence(w.why)}</p>
        <Section title="Measurements"><Rows lines={[
          { label: "Ground cover", value: fmtAreaCm2(w.areaM2 * 10_000, units).text },
          { label: "Size across", value: cm(2 * Math.sqrt(w.areaM2 / Math.PI), units) },
          ...(near ? [{ label: "Nearest corn row", value: `Row ${near.id}, ${cm(near.d, units)} away` }] : []),
          { label: "Position", value: isLocalTwin(twin) ? "local (test flight)" : `${w.lat.toFixed(7)}, ${w.lng.toFixed(7)}` },
        ]} /></Section>
        <Section title="What the photographs said"><Rows lines={[
          { label: "Covered by", value: `${w.coveredBy} photographs` },
          { label: "Saw it", value: `${w.seenBy}` },
          { label: "A weed candidate in", value: `${w.votes.weed}` },
          { label: "On a crop row's line in", value: `${w.votes.crop}` },
          { label: "Unknown vegetation in", value: `${w.votes.unknown}` },
        ]} /><p className="mt-1.5 text-[10px] text-neutral-500">{w.photos.join(", ")}</p></Section>
        <Section title="In the photographs"><Evidence evidence={w.evidence} atlasUrl={atlasUrl} colour={cornWeedColour(w.status)} units={units} /></Section>
        <ReviewOnly />
      </div>
    );
  }
  if (selection.kind === "cornGap") {
    const g = corn.gaps.find(x => x.id === selection.id);
    if (!g) return <p className="text-xs text-neutral-500">That gap is not in this twin.</p>;
    return (
      <div>
        <Header kind="Corn field" title={g.status === "confirmed" ? "Stand gap, confirmed" : "Stand gap, withheld"} colour={gapColour(g.status)} onClose={onClose} />
        <p className="mt-2 text-xs text-neutral-300">{sentence(g.why)}</p>
        <Section title="Measurements"><Rows lines={[{ label: "Length along the row", value: cm(g.lengthM, units) }, { label: "Row", value: `Row ${g.rowId}` }]} /></Section>
        <Section title="What the photographs said"><Rows lines={[
          { label: "Reported it", value: g.reportedBy.length ? g.reportedBy.join(", ") : "none" },
          { label: "Held a corn row there, no gap", value: g.notReportedBy.length ? g.notReportedBy.join(", ") : "none" },
          { label: "Located a plant inside it", value: g.plantSeenBy.length ? g.plantSeenBy.join(", ") : "none" },
        ]} /></Section>
        <Section title="In the photographs"><Evidence evidence={g.evidence} atlasUrl={atlasUrl} colour={gapColour(g.status)} units={units} /></Section>
        <ReviewOnly />
      </div>
    );
  }
  if (selection.kind === "cornRow") {
    const r = corn.rows.find(x => x.id === selection.id);
    if (!r) return <p className="text-xs text-neutral-500">That row is not in this twin.</p>;
    const fr = fieldRowOf(corn, r);
    if (fr != null) {
      // A plants-first row: one object made of its stretches. What it rests on is the plants located along it; the
      // photograph counts per stretch were not measured, so none are shown.
      const v = cornFieldRows(corn).find(x => x.plantsFirst && x.id === fr);
      if (!v) return <p className="text-xs text-neutral-500">That row is not in this twin.</p>;
      const perM = v.perM == null ? "–" : units === "imperial" ? `${(v.perM * 0.3048).toFixed(1)} a foot` : `${v.perM.toFixed(1)} a metre`;
      return (
        <div>
          <Header kind="Corn field" title={`Row ${v.id}`} colour={v.confirmed ? TWIN_COLOURS.cornRow : TWIN_COLOURS.cornRowCourse} onClose={onClose} />
          <p className="mt-2 text-xs text-neutral-300">{v.confirmed ? "A row through the plants the photographs located: cyan where plants were seen along it, a thin grey line where its course continues but no plant was confirmed (the photographs missed the plants there, or there are none: the twin cannot tell which)." : "A row's course with no plant confirmed along it."}</p>
          <Section title="Along the row"><Rows lines={[
            { label: "Length, first plant to last", value: fmtDistance(v.lengthM, units).text },
            { label: "Plants seen along", value: `${fmtDistance(v.confirmedM, units).text} (${v.confirmed} stretch${v.confirmed === 1 ? "" : "es"})` },
            { label: "No plant confirmed", value: `${fmtDistance(v.notConfirmedM, units).text} (${v.notConfirmed} stretch${v.notConfirmed === 1 ? "" : "es"})` },
            ...(v.plants != null ? [{ label: "Plants located on it", value: v.plants.toLocaleString() }, { label: "Seen by most photographs over them", value: (v.certain ?? 0).toLocaleString() }, { label: "Plants located per length", value: perM }] : []),
            ...(v.kind === "geometry" ? [{ label: "Found", value: "in a slot the certain rows leave" }] : []),
          ]} /></Section>
          <Section title="This stretch"><Rows lines={[
            { label: "State", value: r.status === "corn" ? "plants seen along it" : "no plant confirmed" },
            { label: "Length", value: fmtDistance(r.lengthM, units).text },
            ...(r.plants != null ? [{ label: "Plants located on it", value: r.plants.toLocaleString() }] : []),
          ]} /><p className="mt-1.5 text-[10px] text-neutral-500">The plants located on this row, part of the field's plant count. They are located, not identified as corn by their look.</p></Section>
          <ReviewOnly />
        </div>
      );
    }
    const gaps = corn.gaps.filter(g => g.rowId === r.id);
    return (
      <div>
        <Header kind="Corn field" title={r.status === "corn" ? `Corn row ${r.id}` : `Row ${r.id}, crop not confirmed`} colour={rowColour(r.status)} onClose={onClose} />
        <p className="mt-2 text-xs text-neutral-300">{sentence(r.why)}</p>
        <Section title="Measurements"><Rows lines={[
          { label: "Length", value: fmtDistance(r.lengthM, units).text },
          { label: "Held by", value: r.coveredBy > 0 ? `${r.seenBy} of the ${r.coveredBy} photographs covering it` : "not recorded" },
          { label: "Called corn by", value: `${r.cornBy}` },
          { label: "Stand gaps on it", value: `${gaps.filter(g => g.status === "confirmed").length} confirmed, ${gaps.filter(g => g.status === "withheld").length} withheld` },
        ]} /></Section>
        <ReviewOnly />
      </div>
    );
  }
  return null;
}
