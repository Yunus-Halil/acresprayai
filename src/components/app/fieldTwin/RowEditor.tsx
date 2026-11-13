// The row editor's controls on a corn twin (2026-11-13): the panel that opens it, the card for a tapped row, and the
// bar with the last action and Undo. The map side (snapped add, picking within a finger, drawing the corrections) is
// in TwinCanvasLayer and src/lib/fieldTwin/rowEdits.ts. Four verbs only: keep, remove, add, undo
// (reports/Corn row correction design.md, the research behind them).
import type { TwinBundle } from "@/lib/fieldTwin/types";
import type { RowEdits } from "@/lib/fieldTwin/rowEdits";
import { editCounts } from "@/lib/fieldTwin/rowEdits";
import type { TwinPick } from "./TwinCanvasLayer";

const panel = "rounded-md border border-[#343834] bg-[#171a17]";
const btn = "rounded-sm border border-[#3a3f3a] px-2.5 py-1.5 text-[12px] text-neutral-200 hover:bg-[#262a26] disabled:opacity-40";
const primary = "rounded-sm bg-[#f0a63a] px-2.5 py-1.5 text-[12px] font-semibold text-[#171a18] disabled:opacity-40";

export function RowEditPanel(props: {
  edits: RowEdits; editing: boolean; onStart: () => void; onDone: () => void; onClearAll: () => void;
  hideRows: boolean; setHideRows: (v: boolean) => void;
  plants: { count: number; note: string } | null; showPlants: boolean; setShowPlants: (v: boolean) => void;
  photographsOn: boolean;
}) {
  const { edits, editing } = props, n = editCounts(edits), any = n.kept + n.removed + n.added + n.ends > 0;
  return (
    <div className={`w-[272px] px-3 py-2 text-xs ${panel}`} role="group" aria-label="Correct rows">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-neutral-100">Correct rows</span>
        {any && <span className="text-[11px] text-neutral-400 tabular-nums">{[n.added && `${n.added} added`, n.kept && `${n.kept} kept`, n.removed && `${n.removed} removed`, n.ends && `${n.ends} resized`].filter(Boolean).join(" · ")}</span>}
      </div>
      {!editing ? (
        <>
          <p className="mt-1 text-[10px] leading-snug text-neutral-400">A row missed, or drawn where there is none? Tap to add a row, or tap a row to keep or remove it. Your corrections are drawn over the twin; the twin itself is never changed.</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <button type="button" className={primary} onClick={props.onStart}>Edit rows</button>
            {any && <button type="button" className={btn} onClick={props.onClearAll}>Clear my corrections</button>}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[10px] leading-snug text-neutral-300">Tap a seedling, or the ground between rows, to add a row there: it snaps to the rows beside it{props.plants ? " and onto the plants near the tap" : ""}. Tap a row to keep or remove it; drag its white end handles to shorten or lengthen it.</p>
          {!props.photographsOn && <p className="mt-1 text-[10px] leading-snug text-amber-300/90">The photographs are off: you are judging against {props.plants && props.showPlants ? "the located plants" : "the rows alone"}. Turn the reference imagery on (Full, Diagnostics) to see the ground.</p>}
          <div className="mt-1.5 space-y-1">
            <label className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="accent-[#f0a63a]" checked={props.hideRows} onChange={e => props.setHideRows(e.target.checked)} />Hide every row line (see the ground)</label>
            {props.plants && <label className="flex items-start gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="mt-0.5 accent-[#f0a63a]" checked={props.showPlants} onChange={e => props.setShowPlants(e.target.checked)} /><span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-black/60" style={{ background: "#efe6ff" }} />Located plants ({props.plants.count.toLocaleString()}), up close<span className="block text-[10px] leading-snug text-neutral-500">{props.plants.note}</span></span></label>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <button type="button" className={primary} onClick={props.onDone}>Done</button>
          </div>
        </>
      )}
      <p className="mt-1.5 text-[10px] leading-snug text-neutral-500">Saved on this device only, for now.</p>
    </div>
  );
}

/** The card for the row tapped in the editor: keep it, remove it, or take the answer back; an added row can be deleted. */
export function RowActionCard({ selection, twin, edits, onKeep, onRemove, onClear, onDeleteAdded, onClose }: {
  selection: TwinPick; twin: TwinBundle; edits: RowEdits;
  onKeep: (id: number) => void; onRemove: (id: number) => void; onClear: (id: number) => void; onDeleteAdded: (uid: string) => void; onClose: () => void;
}) {
  if (selection?.kind === "addedRow") {
    const a = edits.added.find(x => x.uid === selection.uid);
    if (!a) return null;
    return (
      <Card onClose={onClose} title="A row you added" text={a.snap.method === "between" ? `Snapped between two rows (slot ${a.snap.slot} of ${a.snap.of})${a.snap.plants ? `, onto ${a.snap.plants} located plants` : ""}.` : a.snap.method === "beyond" ? `Snapped ${a.snap.slot} spacing${a.snap.slot > 1 ? "s" : ""} beyond the outer row${a.snap.plants ? `, onto ${a.snap.plants} located plants` : ""}.` : "Placed along the field's row direction; no row was near."}>
        <button type="button" className={btn} onClick={() => onDeleteAdded(a.uid)}>Delete this row</button>
      </Card>
    );
  }
  if (selection?.kind !== "cornRow") return null;
  const r = twin.corn?.rows.find(x => x.id === selection.id);
  if (!r) return null;
  const v = edits.verdicts[String(r.id)];
  return (
    <Card onClose={onClose} title={`Row ${r.id} · ${r.status === "corn" ? "corn row" : "not confirmed by the photographs"}`} text={v === "keep" ? "You kept this row." : v === "remove" ? "You said there is no row here." : "Is there a row here, where it is drawn?"}>
      {v !== "keep" && <button type="button" className={primary} onClick={() => onKeep(r.id)}>It's a row</button>}
      {v !== "remove" && <button type="button" className={btn} onClick={() => onRemove(r.id)}>No row here</button>}
      {v && <button type="button" className={btn} onClick={() => onClear(r.id)}>Take my answer back</button>}
    </Card>
  );
}

function Card({ title, text, children, onClose }: { title: string; text: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className={`px-3 py-2 text-xs shadow-lg ${panel}`} role="dialog" aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold text-neutral-100">{title}</span>
        <button type="button" className="-mr-1 rounded-sm px-1 text-[14px] leading-none text-neutral-500 hover:text-neutral-200" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="mt-0.5 text-[11px] text-neutral-400">{text}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** The last action and Undo, while the editor is open. */
export function RowUndoBar({ last, canUndo, onUndo, note }: { last: string | null; canUndo: boolean; onUndo: () => void; note: string | null }) {
  if (!last && !note) return null;
  return (
    <div className={`flex items-center gap-3 px-3 py-2 text-xs ${panel}`} role="status" aria-live="polite">
      {note ? <span className="text-amber-300/90">{note}</span> : <span className="text-neutral-200">{last}</span>}
      {canUndo && <button type="button" className={primary} onClick={onUndo}>Undo</button>}
    </div>
  );
}
