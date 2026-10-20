// The crop rows, settled once per field: what the weed search treats as the
// crop and leaves out. The rows are read automatically; the operator confirms
// them or marks three plants (two neighbours in a row, one in the next row),
// and the field's planting layout is fitted to the whole map from those. Once
// saved, every scan of the field uses it, and the weed model is shown only
// what grows between the rows.
import { Loader2 } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtDistance } from "@/lib/units";
import { useFrameRun } from "@/lib/weedVision/frameRunStore";
import { MIN_TRUSTED_FOUND, MIN_TRUSTED_ROWS } from "@/lib/weedVision/layout/readLayout";
import { acceptReaderRows, cancelMarking, clearLayout, pickPosition, rereadRows, saveLayout, setShowRows, setVerdict, startMarking, undoLastPlanting, useLayoutUi } from "@/lib/weedVision/layout/layoutUi";

const STATE_TEXT: Record<string, string> = {
  confirmed: "A crop here. A dashed ring means its canopy runs into other green, so the ring is the planting's typical size, not measured.",
  probable: "Only a little green here: a young tree, or a weed at a tree's place.",
  ambiguous: "Weak green that runs into other green: a crown among weeds, or weeds alone.",
  operator: "You said: a crop here.",
  none: "An expected position with no visible plant.",
  some: "An expected position with a little green under the bar: a young tree, or a weed.",
};

const STEP = ["Click a tree.", "Click its neighbour in the same row.", "Click a tree in the next row."] as const;

export function CropRowsPanel({ taskId, fieldId, userId }: { taskId: string; fieldId: string | null; userId: string | null }) {
  const run = useFrameRun(taskId);
  const ui = useLayoutUi(taskId);
  const units = useUnitSystem();
  const d = (m: number) => fmtDistance(m, units).text;
  const fr = run.fieldRows, stats = run.layoutStats;
  const fromLayout = run.fieldRowsSource === "layout";
  const btn = "rounded-sm border px-2 py-0.5 text-[11px] disabled:opacity-40";
  return (
    <div className="rounded-sm border border-[#2a2a2a] p-3 space-y-1.5 text-[11px]" data-testid="crop-rows-panel">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-neutral-200">Crop rows</span>
        {fr && !ui.clicking && (
          <label className="inline-flex items-center gap-1 text-neutral-400"><input type="checkbox" checked={ui.show} onChange={e => setShowRows(taskId, e.target.checked)} /> show on map</label>
        )}
      </div>

      {ui.clicking ? (
        <div className="space-y-1" data-testid="crop-rows-marking">
          <p className="text-[#22d3ee]">{STEP[Math.min(2, ui.clicks.length)]} ({ui.clicks.length + 1} of 3)</p>
          <p className="text-neutral-500">Click the middle of each tree. The whole planting is found from these three.</p>
          <button type="button" className={`${btn} border-[#333] text-neutral-300`} onClick={() => cancelMarking(taskId)}>Cancel</button>
        </div>
      ) : run.fieldRowsState === "reading" ? (
        <p className="text-neutral-500 inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Finding the crop rows on the map{run.fieldRowsProgress ? ` (${Math.round(run.fieldRowsProgress * 100)}%)` : ""}…</p>
      ) : fromLayout && fr && stats ? (
        <div className="space-y-1" data-testid="crop-rows-layout">
          <p className="text-neutral-200">
            {fr.rows} row{fr.rows === 1 ? "" : "s"}, {stats.plants.toLocaleString()} trees{stats.gaps ? `, ${stats.gaps.toLocaleString()} missing` : ""}: rows {d(fr.spacingM)} apart, trees {d(fr.seedSpacingM)} apart.
          </p>
          <p className="text-neutral-500">Weeds are looked for only between these rows; the rows themselves are left out of the search.</p>
          {(fr.rows < MIN_TRUSTED_ROWS || stats.foundShare < MIN_TRUSTED_FOUND) && (
            <p className="text-amber-400" data-testid="crop-rows-doubtful">This does not look like the whole planting ({fr.rows} row{fr.rows === 1 ? "" : "s"}, {Math.round(stats.foundShare * 100)}% of the expected trees found). Check it on the map; if it is wrong, start over and mark three trees.</p>
          )}
          {stats.unexplained > 0 && (
            <p className="text-amber-400" data-testid="crop-rows-unexplained">{stats.unexplained} tree-sized green patch{stats.unexplained === 1 ? " is" : "es are"} on no row (orange rings). If that is another block of trees, mark three trees there.</p>
          )}
          {ui.unsaved ? <p className="text-amber-400">Not saved yet.</p> : <p className="text-neutral-500">{ui.savedTo === "browser" ? "Saved in this browser." : "Saved for this field."}</p>}
          <div className="flex flex-wrap gap-1.5">
            {ui.unsaved && fieldId && <button type="button" className={`${btn} border-[#4ade80] text-[#4ade80]`} disabled={ui.saving} onClick={() => void saveLayout(taskId, { fieldId, userId })} data-testid="crop-rows-save">{ui.saving ? "Saving…" : "Save for this field"}</button>}
            <button type="button" className={`${btn} border-[#333] text-neutral-300`} onClick={() => rereadRows(taskId)} data-testid="crop-rows-reread">Read the rows again</button>
            <button type="button" className={`${btn} border-[#333] text-neutral-300`} onClick={() => startMarking(taskId)} data-testid="crop-rows-add">Mark another block</button>
            {ui.unsaved && <button type="button" className={`${btn} border-[#333] text-neutral-300`} onClick={() => undoLastPlanting(taskId)}>Undo last block</button>}
            <button type="button" className={`${btn} border-[#333] text-neutral-500`} onClick={() => void clearLayout(taskId, fieldId)} title="Forgets the marked trees for this field">Start over</button>
          </div>
        </div>
      ) : fr ? (
        <div className="space-y-1" data-testid="crop-rows-auto">
          <p className="text-neutral-300">Found {fr.rows} rows automatically: about {d(fr.spacingM)} apart, plants about {d(fr.seedSpacingM)} apart. Not confirmed.</p>
          <p className="text-neutral-500">Turn on "show on map" and check them. If they sit on the trees, confirm; if not, mark three trees.</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={`${btn} border-[#4ade80] text-[#4ade80]`} onClick={() => acceptReaderRows(taskId)} data-testid="crop-rows-accept">They are right</button>
            <button type="button" className={`${btn} border-[#22d3ee] text-[#22d3ee]`} onClick={() => startMarking(taskId)} data-testid="crop-rows-mark">Mark three trees</button>
            <button type="button" className={`${btn} border-[#333] text-neutral-400`} onClick={() => rereadRows(taskId)}>Read again</button>
          </div>
        </div>
      ) : (
        <div className="space-y-1" data-testid="crop-rows-none">
          <p className="text-amber-400">No crop rows were found automatically, so the crop cannot be told from the weeds yet.</p>
          <p className="text-neutral-500">Mark three trees once and Weed Scout finds the whole planting.</p>
          <button type="button" className={`${btn} border-[#22d3ee] text-[#22d3ee]`} onClick={() => startMarking(taskId)} data-testid="crop-rows-mark">Mark three trees</button>
        </div>
      )}
      {ui.picked && fromLayout && (
        <div className="rounded-sm border border-[#3a3a3a] p-2 space-y-1.5" data-testid="crop-rows-verdict">
          <p className="text-neutral-200">{STATE_TEXT[ui.picked.state] ?? ui.picked.state}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={`${btn} border-[#4ade80] text-[#4ade80]`} onClick={() => void setVerdict(taskId, { fieldId, userId, crop: true })} data-testid="verdict-crop">A crop</button>
            <button type="button" className={`${btn} border-[#ff1a1a] text-[#ff1a1a]`} onClick={() => void setVerdict(taskId, { fieldId, userId, crop: false })} data-testid="verdict-none">No crop</button>
            {(ui.picked.state === "operator") && <button type="button" className={`${btn} border-[#333] text-neutral-300`} onClick={() => void setVerdict(taskId, { fieldId, userId, crop: null })}>Forget my word</button>}
            <button type="button" className={`${btn} border-[#333] text-neutral-500`} onClick={() => pickPosition(taskId, null)}>Leave it</button>
          </div>
          <p className="text-neutral-600">Your word is kept for this field and used from now on. A weed at a tree's place stays a weed unless you say otherwise.</p>
        </div>
      )}
      {fromLayout && !ui.picked && !ui.clicking && (
        <p className="text-neutral-600">Rings: green a crop (dashed where its canopy runs into other green), "?" only a little green there, red cross nothing there. Click a ring or a cross to say what is there.</p>
      )}
      {run.fieldRowsNote && <p className="text-amber-400" data-testid="crop-rows-note">{run.fieldRowsNote}</p>}
      {ui.error && <p className="text-red-400">{ui.error}</p>}
    </div>
  );
}
