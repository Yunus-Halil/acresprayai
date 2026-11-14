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
import EvidenceCrop from "./EvidenceCrop";
import type { TwinPick } from "./TwinCanvasLayer";

const panel = "rounded-md border border-[#343834] bg-[#171a17]";
const cm = (m: number, u: UnitSystem) => fmtLengthCm(m * 100, u).text;
type Line = { label: string; value: string };

const gapColour = cornGapColour, rowColour = cornRowColour;

const middle = (line: [number, number][]) => line[line.length >> 1];

type ListKey = "confirmedWeeds" | "otherWeeds" | "gaps" | "withheldGaps" | "rows";

/** The left-column panel for a corn twin. */
export function CornFieldPanel({ twin, corn, layers, setLayers, onSelect, units, showPlants, setShowPlants, plantCount = null }: { twin: TwinBundle; corn: TwinCorn; layers: TwinLayers; setLayers: (f: (l: TwinLayers) => TwinLayers) => void; onSelect: (p: TwinPick, lat: number, lng: number, metresAcross: number) => void; units: UnitSystem; showPlants: boolean; setShowPlants: (v: boolean) => void; plantCount?: number | null }) {
  const s = corn.summary;
  const fieldRows = useMemo(() => cornFieldRows(corn), [corn]);
  const plantsFirst = fieldRows.some(r => r.plantsFirst);
  const R = useMemo(() => ({ n: fieldRows.length, confirmedM: fieldRows.reduce((t, r) => t + r.confirmedM, 0), notConfirmedM: fieldRows.reduce((t, r) => t + r.notConfirmedM, 0), courseOnly: fieldRows.filter(r => r.confirmed === 0).length }), [fieldRows]);
  const P = corn.plants?.summary ?? null;
  const hidden = s.weeds.unconfirmed + s.weeds.contested + s.gaps.withheld + (P ? P.onNoRow + P.betweenRows : 0);
  const [list, setList] = useState<ListKey>("confirmedWeeds");
  const [open, setOpen] = useState(true);
  const items = useMemo(() => {
    const byArea = (a: TwinCornWeed, b: TwinCornWeed) => b.areaM2 - a.areaM2;
    if (list === "confirmedWeeds") return corn.weeds.filter(w => w.status === "confirmed").sort(byArea).map(w => ({ key: `w${w.id}`, colour: cornWeedColour(w.status), title: `Weed ${w.id}`, detail: `${fmtAreaCm2(w.areaM2 * 10_000, units).text}, a weed in ${w.votes.weed} of the ${w.seenBy} photographs that saw it`, pick: { kind: "cornWeed", id: w.id } as TwinPick, lat: w.lat, lng: w.lng, across: 2 }));
    if (list === "otherWeeds") return corn.weeds.filter(w => w.status !== "confirmed").sort(byArea).map(w => ({ key: `w${w.id}`, colour: cornWeedColour(w.status), title: `${w.status === "contested" ? "Contested" : "Unconfirmed"} ${w.id}`, detail: `${fmtAreaCm2(w.areaM2 * 10_000, units).text}, weed in ${w.votes.weed}, crop in ${w.votes.crop} of the ${w.seenBy} that saw it`, pick: { kind: "cornWeed", id: w.id } as TwinPick, lat: w.lat, lng: w.lng, across: 2 }));
    if (list === "gaps" || list === "withheldGaps") return corn.gaps.filter(g => (list === "gaps" ? g.status === "confirmed" : g.status === "withheld")).sort((a, b) => b.lengthM - a.lengthM).map(g => ({ key: `g${g.id}`, colour: gapColour(g.status), title: `Gap ${g.id}, row ${g.rowId}`, detail: `${cm(g.lengthM, units)}, reported by ${g.reportedBy.length}`, pick: { kind: "cornGap", id: g.id } as TwinPick, lat: (g.a[0] + g.b[0]) / 2, lng: (g.a[1] + g.b[1]) / 2, across: Math.max(3, g.lengthM * 2.5) }));
    // One entry per field row (its stretches are one object), longest first.
    return [...fieldRows].sort((a, b) => b.lengthM - a.lengthM).map(v => {
      const first = corn.rows[v.stretches.find(i => corn.rows[i].status === "corn") ?? v.stretches[0]], line = corn.rows[v.stretches[v.stretches.length >> 1]].line;
      return { key: `r${v.id}`, colour: v.confirmed ? TWIN_COLOURS.cornRow : TWIN_COLOURS.cornRowCourse, title: `Row ${v.id}${v.confirmed ? "" : v.plantsFirst ? ", no plant confirmed" : ", crop not confirmed"}`, detail: rowListDetail(v, units), pick: { kind: "cornRow", id: first.id } as TwinPick, lat: middle(line)[0], lng: middle(line)[1], across: Math.max(6, v.lengthM * 1.1) };
    });
  }, [list, corn, units, fieldRows]);
  const tab = (k: ListKey, label: string, n: number) => (
    <button key={k} type="button" onClick={() => setList(k)} aria-pressed={list === k} className={`rounded-[2px] px-1.5 py-0.5 text-[10px] ${list === k ? "bg-[#f0a63a] font-semibold text-[#171a18]" : "text-neutral-300 hover:bg-[#262a26]"}`}>{label} {n}</button>
  );
  const check = (k: "corn" | "cornUncertain", label: string, hint: string) => (
    <label className="flex items-start gap-2 py-0.5 text-[11px] text-neutral-200">
      <input type="checkbox" className="mt-0.5 accent-[#f0a63a]" checked={layers[k]} onChange={e => setLayers(l => ({ ...l, [k]: e.target.checked }))} />
      <span>{label}<span className="block text-[10px] leading-snug text-neutral-500">{hint}</span></span>
    </label>
  );
  return (
    <div className={`w-[272px] px-3 py-2 text-xs ${panel}`} role="group" aria-label="Corn">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="font-semibold text-neutral-100">Corn</span>
        <span className="text-[10px] text-neutral-400">{R.n} rows · {s.weeds.confirmed} weeds · {s.gaps.confirmed} gaps</span>
      </button>
      {open && <>
        <p className="mt-1 text-[10px] leading-snug text-neutral-400">Every photograph read by Corn V1, combined over the field ({corn.photographs.read} photographs). The crop is your entry. Review-only: a finding is something to look at, not a treatment decision.</p>
        {isLocalTwin(twin) && <p className="mt-1 text-[10px] leading-snug text-amber-300/90">Test flight, locally aligned: positions are relative to each other and the scale is estimated from the corn rows. Not a place on the map.</p>}
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-neutral-400">Rows</dt><dd className="text-right tabular-nums text-neutral-100">{R.n}{R.courseOnly ? ` (${R.courseOnly} ${plantsFirst ? "with no plant confirmed" : "crop not confirmed"})` : ""}</dd>
          <dt className="text-neutral-400"><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: TWIN_COLOURS.cornRow }} />{plantsFirst ? "Plants seen along" : "Corn rows"}</dt><dd className="text-right tabular-nums text-neutral-100">{fmtDistance(R.confirmedM, units).text}</dd>
          <dt className="text-neutral-400"><span className="mr-1 inline-block h-px w-3 align-middle" style={{ background: TWIN_COLOURS.cornRowCourse }} />{plantsFirst ? "No plant confirmed" : "Crop not confirmed"}</dt><dd className="text-right tabular-nums text-neutral-100">{fmtDistance(R.notConfirmedM, units).text}</dd>
          {P && <><dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full border border-black/60" style={{ background: TWIN_COLOURS.plantLocated }} />Plants located on rows</dt><dd className="text-right tabular-nums text-neutral-100">{(P.certain + P.probable).toLocaleString()}</dd></>}
          <dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornWeed }} />Weeds, confirmed</dt><dd className="text-right tabular-nums text-neutral-100">{s.weeds.confirmed}</dd>
          <dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornWeedUnconfirmed }} />Not confirmed / contested</dt><dd className="text-right tabular-nums text-neutral-100">{s.weeds.unconfirmed} / {s.weeds.contested}</dd>
          <dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornGap }} />Stand gaps</dt><dd className="text-right tabular-nums text-neutral-100">{s.gaps.confirmed} ({cm(s.gaps.confirmedLengthM, units)})</dd>
          <dt className="text-neutral-400"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TWIN_COLOURS.cornGapWithheld }} />Gaps withheld</dt><dd className="text-right tabular-nums text-neutral-100">{s.gaps.withheld}</dd>
          <dt className="text-neutral-400">Row spacing</dt><dd className="text-right tabular-nums text-neutral-100">{corn.rowSpacingM != null ? cm(corn.rowSpacingM, units) : "–"}{isLocalTwin(twin) ? " (scale estimated)" : ""}</dd>
          <dt className="text-neutral-400">Photographs agree on rows</dt><dd className="text-right tabular-nums text-neutral-100">{corn.rowAgreementM != null ? `within ${cm(corn.rowAgreementM, units)}` : "–"}</dd>
        </dl>
        {/* What the field combination left out or withheld on this flight, in its own words (the last note is the review-only line above). */}
        {corn.notes.length > 1 && <ul className="mt-1.5 space-y-1 border-l border-[#2e322e] pl-2 text-[10px] leading-snug text-neutral-400" aria-label="Notes on this flight">{corn.notes.slice(0, -1).map(n => <li key={n}>{n}</li>)}</ul>}
        <div className="mt-1.5 border-t border-[#2e322e] pt-1">
          {check("corn", "Corn rows, weeds and gaps", "what the photographs confirm; a row's course where they do not, thin grey")}
          {(corn.plants || plantCount) && <label className="flex items-start gap-2 py-0.5 text-[11px] text-neutral-200"><input type="checkbox" className="mt-0.5 accent-[#f0a63a]" checked={showPlants} onChange={e => setShowPlants(e.target.checked)} /><span>Located plants, up close<span className="block text-[10px] leading-snug text-neutral-500">one dot per plant two or more photographs located; not a stand count</span></span></label>}
          {check("cornUncertain", `Observations not confirmed${hidden ? ` (${hidden.toLocaleString()})` : ""}`, `weed candidates not repeated or contested, gaps withheld${P ? ", plants seen on no row or between the rows" : ""}: kept for review, never findings`)}
        </div>
        <div className="mt-1.5 border-t border-[#2e322e] pt-1.5">
          <div className="flex flex-wrap gap-0.5">
            {tab("confirmedWeeds", "Weeds", s.weeds.confirmed)}
            {tab("otherWeeds", "Unconfirmed", s.weeds.unconfirmed + s.weeds.contested)}
            {tab("gaps", "Gaps", s.gaps.confirmed)}
            {tab("withheldGaps", "Withheld", s.gaps.withheld)}
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
export function CornLegend({ corn, showPlants, uncertain }: { corn: TwinCorn; showPlants: boolean; uncertain: boolean }) {
  const plantsFirst = useMemo(() => cornFieldRows(corn).some(r => r.plantsFirst), [corn]);
  const item = (key: string, swatch: React.ReactNode, text: string) => <span key={key} className="flex items-center gap-1.5">{swatch}{text}</span>;
  const line = (colour: string, h: number, dash = false) => <span className="inline-block w-4 shrink-0" style={{ height: h, background: dash ? `repeating-linear-gradient(90deg, ${colour} 0 3px, transparent 3px 6px)` : colour }} />;
  const dot = (fill: string | null, stroke: string) => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: fill ?? "transparent", border: `1.5px solid ${stroke}` }} />;
  const items = [
    item("row", line(TWIN_COLOURS.cornRow, 3), plantsFirst ? "Row, plants seen along it" : "Corn row"),
    item("course", line(TWIN_COLOURS.cornRowCourse, 1), plantsFirst ? "Row continues, no plant confirmed" : "Row, crop not confirmed"),
    showPlants && item("p0", dot(TWIN_COLOURS.plantLocated, "#141614"), "Plant, seen by most photographs over it"),
    showPlants && item("p1", dot(null, TWIN_COLOURS.plantLocated), "Plant, probable (on a row, at the spacing)"),
    showPlants && uncertain && item("p2", dot("#8c929a", "#8c929a"), "Plant seen on no row"),
    showPlants && uncertain && item("p3", <span className="inline-block w-2 shrink-0 text-center leading-none text-[#8c929a]">×</span>, "Green between two rows, not the crop"),
    item("w1", dot("rgba(239,83,80,0.35)", TWIN_COLOURS.cornWeed), "Weed candidate, confirmed"),
    uncertain && item("w2", dot(null, TWIN_COLOURS.cornWeedUnconfirmed), "Weed candidate, not confirmed"),
    uncertain && item("w3", dot(null, TWIN_COLOURS.cornWeedContested), "Contested: crop or weed"),
    item("g1", line(TWIN_COLOURS.cornGap, 4), "Stand gap, confirmed"),
    uncertain && item("g2", line(TWIN_COLOURS.cornGapWithheld, 2, true), "Gap withheld"),
    item("unseen", <span className="inline-block h-2.5 w-3.5 shrink-0 rounded-sm border border-[#3a3f3a]" style={{ background: `repeating-linear-gradient(135deg, ${TWIN_COLOURS.hatch} 0 1px, ${TWIN_COLOURS.imagery} 1px 4px)` }} />, "Not photographed"),
  ];
  return <div className="mt-1.5 grid grid-cols-1 gap-y-0.5 text-[10px] text-neutral-400 sm:grid-cols-2 sm:gap-x-3" aria-label="Corn legend">{items.filter(Boolean)}</div>;
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
const ReviewOnly = () => <p className="mt-3 text-[10px] leading-snug text-neutral-500">Review-only: a candidate to look at in the field or in the photographs, not a treatment decision. The crop is the operator's entry; nothing here tells corn from another row crop by its look.</p>;

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

/** The inspector for a corn selection, or null when the selection is not corn. */
export function CornInspector({ twin, selection, atlasUrl, onClose }: { twin: TwinBundle; selection: TwinPick; atlasUrl: (i: number) => Promise<string>; onClose: () => void }) {
  const units = useUnitSystem();
  const corn = twin.corn;
  if (!corn || !selection) return null;
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
          ]} /><p className="mt-1.5 text-[10px] text-neutral-500">Plants are located, not identified as corn by their look; this is not a stand count.</p></Section>
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
