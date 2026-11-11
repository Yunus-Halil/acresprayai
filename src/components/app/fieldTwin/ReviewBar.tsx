// "Your review" on the selected finding: Correct, Not sure or Wrong, and a note. Shown above the inspector for every
// object a participant can judge. The algorithm's label stays as it was; the review sits beside it.
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { FindingsResult } from "@/lib/fieldTwin/findings";
import type { TwinBundle } from "@/lib/fieldTwin/types";
import { type FindingKind, type Review, SAYS_OPTIONS, VERDICT_LABEL, type Verdict, reviewKey, saysLabel } from "@/lib/fieldTwin/reviews";
import type { TwinPick } from "./TwinCanvasLayer";

export type ReviewTarget = { kind: FindingKind; id: string; status: string; question: string };

/** What a selection is, as something to review; null for markers that only group others. */
export function reviewTargetOf(selection: TwinPick, twin: TwinBundle, findings: FindingsResult | null): ReviewTarget | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "weed": { const w = twin.weeds.find(x => x.id === selection.id); return w ? { kind: "weed", id: String(w.id), status: w.status, question: "Is this really a weed?" } : null; }
    case "tree": return { kind: "tree", id: String(selection.id), status: "tree", question: "Is this a crop tree, where it is drawn?" };
    case "vegetation": return { kind: "vegetation", id: String(selection.id), status: "unclassed", question: "Is there green growth here, as outlined?" };
    case "cornRow": { const r = twin.corn?.rows.find(x => x.id === selection.id); return r ? { kind: "corn_row", id: String(r.id), status: r.status, question: "Is this a corn row, where it is drawn?" } : null; }
    case "cornWeed": { const w = twin.corn?.weeds.find(x => x.id === selection.id); return w ? { kind: "corn_weed", id: String(w.id), status: w.status, question: "Is this really a weed, not corn or soil?" } : null; }
    case "cornGap": { const g = twin.corn?.gaps.find(x => x.id === selection.id); return g ? { kind: "corn_gap", id: String(g.id), status: g.status, question: "Is this really a gap in the stand?" } : null; }
    case "zone": return { kind: "zone", id: String(selection.id), status: "zone", question: "Is there really weed pressure here?" };
    case "finding": {
      const f = findings?.findings[selection.index];
      if (!f || f.kind === "weed") return null;
      return { kind: f.kind === "patch" ? "patch" : "region", id: String(f.id), status: f.kind, question: f.kind === "patch" ? "Is this a patch of weeds?" : "Is there really weed pressure here?" };
    }
    default: return null;
  }
}

/** The algorithm's label on a corn finding, in words (the twin's own states, unchanged). */
function swardusSaid(t: ReviewTarget): string {
  if (t.kind === "corn_weed") return t.status === "confirmed" ? "Weed candidate, confirmed" : t.status === "contested" ? "Weed candidate, contested" : "Weed candidate, not confirmed";
  if (t.kind === "corn_row") return t.status === "corn" ? "Corn row" : "Row, crop not confirmed";
  if (t.kind === "corn_gap") return t.status === "confirmed" ? "Stand gap, confirmed" : "Stand gap, withheld";
  return t.status;
}

type Props = {
  target: ReviewTarget;
  reviews: Map<string, Review> | null;
  onSave: (r: { kind: FindingKind; id: string; verdict: Verdict; note: string | null; algorithmStatus: string; says?: string | null }) => Promise<unknown>;
  onClear: (kind: FindingKind, id: string) => Promise<unknown>;
  /** Why reviews are off (the twin is not saved to the account yet). */
  disabledReason?: string | null;
  /** Offer "what is it" on a corn finding marked wrong (off when the database cannot store the answer). */
  canSay?: boolean;
};

export default function ReviewBar({ target, reviews, onSave, onClear, disabledReason, canSay = false }: Props) {
  const existing = reviews?.get(reviewKey(target.kind, target.id)) ?? null;
  const [note, setNote] = useState(existing?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(!!existing?.note);
  const [saving, setSaving] = useState<Verdict | "note" | "says" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { setNote(existing?.note ?? ""); setNoteOpen(!!existing?.note); setFailed(null); }, [target.kind, target.id, existing?.note]);

  // Corn findings only: what the reviewer says is there, once they have said the finding is wrong.
  const says = SAYS_OPTIONS[target.kind] ?? null;
  const said = existing?.verdict === "wrong" ? saysLabel(target.kind, existing.says) : null;
  /** The answer travels with every save of a corn finding (kept on "wrong", dropped otherwise); other kinds save as before. */
  const withSays = (verdict: Verdict, value: string | null) => (says ? { says: verdict === "wrong" ? value : null } : {});

  const choose = async (verdict: Verdict) => {
    setSaving(verdict); setFailed(null);
    try {
      if (existing?.verdict === verdict && !note.trim()) await onClear(target.kind, target.id);
      else await onSave({ kind: target.kind, id: target.id, verdict, note: note || null, algorithmStatus: target.status, ...withSays(verdict, existing?.says ?? null) });
    } catch (e) { setFailed((e as Error).message); } finally { setSaving(null); }
  };
  const saveNote = async () => {
    if (!existing) return;
    setSaving("note"); setFailed(null);
    try { await onSave({ kind: target.kind, id: target.id, verdict: existing.verdict, note: note || null, algorithmStatus: target.status, ...withSays(existing.verdict, existing.says ?? null) }); }
    catch (e) { setFailed((e as Error).message); } finally { setSaving(null); }
  };
  /** An answer chosen; the same one again takes it back (the finding stays marked wrong). */
  const chooseSays = async (value: string) => {
    if (!existing || existing.verdict !== "wrong") return;
    setSaving("says"); setFailed(null);
    try { await onSave({ kind: target.kind, id: target.id, verdict: "wrong", note: note || null, algorithmStatus: target.status, says: existing.says === value ? null : value }); }
    catch (e) { setFailed((e as Error).message); } finally { setSaving(null); }
  };

  // Corn findings are reviewed in the field, on a tablet: their buttons are a full finger tall (44 CSS pixels). The
  // other kinds keep the size they had.
  const touch = says ? "min-h-[44px]" : "";
  const btn = (v: Verdict) => {
    const on = existing?.verdict === v;
    const tone = v === "correct" ? "bg-emerald-500 text-[#0f140f]" : v === "wrong" ? "bg-red-400 text-[#140f0f]" : "bg-neutral-300 text-[#141414]";
    return (
      <button key={v} type="button" onClick={() => void choose(v)} disabled={!!saving || !!disabledReason || !reviews} aria-pressed={on}
        className={`flex-1 rounded-sm border px-2 py-1.5 text-xs font-semibold disabled:opacity-50 ${touch} ${on ? `${tone} border-transparent` : "border-[#3a3f3a] text-neutral-200 hover:bg-[#262a26]"}`}>
        {saving === v ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : VERDICT_LABEL[v]}
      </button>
    );
  };

  return (
    <section className="mb-3 rounded-md border border-[#3a3f3a] bg-[#1d211d] p-2.5" aria-label="Your review">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-neutral-100">Your review</h3>
        {existing && <span className="flex items-center gap-1 text-[10px] text-emerald-300"><Check className="h-3 w-3" />Saved</span>}
      </div>
      <p className="mt-0.5 text-[11px] text-neutral-400">{target.question}</p>
      <div className={`mt-1.5 flex ${says ? "gap-2" : "gap-1"}`}>{(["correct", "unsure", "wrong"] as Verdict[]).map(btn)}</div>
      {says && existing?.verdict === "wrong" && !disabledReason && (canSay || said) && (
        <div className="mt-2" role="group" aria-label={says.ask}>
          <p className="text-[11px] text-neutral-400">{says.ask} <span className="text-neutral-500">Optional.</span></p>
          <div className="mt-1 flex flex-wrap gap-2">
            {says.options.map(o => {
              const on = existing.says === o.value;
              return (
                <button key={o.value} type="button" onClick={() => void chooseSays(o.value)} disabled={!!saving || !canSay} aria-pressed={on}
                  className={`min-h-[44px] rounded-sm border px-3 py-1.5 text-xs disabled:opacity-50 ${on ? "border-transparent bg-sky-300 font-semibold text-[#0f1214]" : "border-[#3a3f3a] text-neutral-200 hover:bg-[#262a26]"}`}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {says && existing && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]" aria-label="What Swardus measured and what you said">
          <dt className="text-neutral-500">Swardus</dt><dd className="text-neutral-300">{swardusSaid(target)}</dd>
          <dt className="text-neutral-500">You</dt><dd className="text-sky-200">{VERDICT_LABEL[existing.verdict]}{said ? `: ${said.charAt(0).toLowerCase()}${said.slice(1)}` : ""}</dd>
        </dl>
      )}
      {disabledReason ?<p className="mt-1.5 text-[10px] text-amber-300/90">{disabledReason}</p> : (
        <>
          {!noteOpen ? (
            <button type="button" className="mt-1.5 text-[11px] text-neutral-400 underline underline-offset-2 hover:text-neutral-200" onClick={() => setNoteOpen(true)}>Add a note</button>
          ) : (
            <div className="mt-1.5">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000} aria-label="Note"
                placeholder={target.kind === "weed" || target.kind === "corn_weed" ? "What is it? (volunteer corn, a stone, a crop leaf...)" : "What did you see?"}
                className="w-full rounded-sm border border-[#3a3f3a] bg-[#111311] px-2 py-1 text-xs text-neutral-100" />
              {existing ? <button type="button" className="mt-1 rounded-sm border border-[#3a3f3a] px-2 py-0.5 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={() => void saveNote()} disabled={!!saving || note === (existing.note ?? "")}>{saving === "note" ? "Saving" : "Save the note"}</button>
                : <p className="mt-0.5 text-[10px] text-neutral-500">The note is saved with your answer above.</p>}
            </div>
          )}
          <p className="mt-1.5 text-[10px] leading-snug text-neutral-500">Your answer is kept beside what Swardus measured and never changes it. Tap your answer again to take it back.</p>
        </>
      )}
      {failed && <p role="alert" className="mt-1 text-[11px] text-red-300">Not saved: {failed}</p>}
    </section>
  );
}
