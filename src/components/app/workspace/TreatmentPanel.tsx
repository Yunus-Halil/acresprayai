// Treatment (operator-reviewed): the product the operator chose for each
// group of zones, the label they verified for it, and the quantities that
// follow, or "Quantity not calculated" and why.
//
// Nothing here picks a chemical. The weed catalog carries no herbicide data
// (its README says so, on purpose), so there is no list to default from and
// none is invented: the operator enters the product from its current label,
// says where the label came from and when they checked it, and ticks that
// they read it for this crop, place and method. Only then does the panel do
// arithmetic (lib/treatment/quantities.ts), and it recomputes whenever the
// zones, the rate or the tank change. A weed spot the operator never
// identified sits in an "unidentified" group and still needs an explicit
// choice; a suggestion is never a spray setting.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Beaker, Loader2, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import type { FarmerSettings } from "@/lib/farmerSettings";
import { deleteTreatmentChoice, listTreatmentChoices, saveTreatmentChoice } from "@/lib/treatment/choices";
import {
  CARRIER_UNITS, NOT_CALCULATED, RATE_UNITS, type CarrierUnit, type RateUnit, type TreatmentChoice, type TreatmentGroup,
  choiceProblems, computeQuantities,
} from "@/lib/treatment/quantities";
import { type UnitSystem, fmtArea, fmtMass, fmtVolume } from "@/lib/units";

const LABEL = "text-[10px] uppercase tracking-wider text-neutral-500";
const INPUT = "w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded-sm px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-[#4CAF50]/60";

export type TreatmentPanelProps = {
  groups: Omit<TreatmentGroup, "choice">[];
  settings: FarmerSettings;
  onSaveSettings: (s: FarmerSettings) => Promise<boolean | void> | boolean | void;
  fieldId: string | null;
  fieldCrop: string | null;
  tankCapacityL: number | null;
  tankLoadPct: number;
  applicationVolumeLha: number | null;
  units: UnitSystem;
};

export default function TreatmentPanel({
  groups, settings, onSaveSettings, fieldId, fieldCrop, tankCapacityL, tankLoadPct, applicationVolumeLha, units,
}: TreatmentPanelProps) {
  const { user } = useAuth();
  const [choices, setChoices] = useState<TreatmentChoice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<{ groupKey: string; groupLabel: string; editing: TreatmentChoice | null } | null>(null);
  const [open, setOpen] = useState(true);

  const reload = () => listTreatmentChoices().then(rows => { setChoices(rows); setLoadError(null); }).catch(e => setLoadError((e as Error).message));
  useEffect(() => { reload(); }, []);

  const assignments = settings.treatment_assignments ?? {};
  const resolved: TreatmentGroup[] = useMemo(
    () => groups.map(g => ({ ...g, choice: choices.find(c => c.id === assignments[g.key]?.choice_id) ?? null })),
    [groups, choices, assignments],
  );
  const result = useMemo(
    () => computeQuantities(resolved, { tankCapacityL, tankLoadPct, applicationVolumeLha, fieldCrop }),
    [resolved, tankCapacityL, tankLoadPct, applicationVolumeLha, fieldCrop],
  );

  const assign = (groupKey: string, groupLabel: string, choiceId: string | null) => {
    const next = { ...assignments };
    if (choiceId) next[groupKey] = { choice_id: choiceId, label: groupLabel }; else delete next[groupKey];
    void onSaveSettings({ ...settings, treatment_assignments: next });
  };

  const amountText = (amount: number, unit: "L" | "kg") => (unit === "L" ? fmtVolume(amount, units, 2).text : fmtMass(amount, units).text);

  if (!groups.length) return null;

  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen(o => !o)} className={`${LABEL} mb-2 flex items-center justify-between w-full`}>
        <span className="inline-flex items-center gap-1.5"><Beaker className="h-3 w-3 text-[#4CAF50]" /> Treatment (operator-reviewed)</span>
        <span className="normal-case tracking-normal text-neutral-600">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="rounded-sm border border-[#222] p-3 text-xs space-y-3" style={{ background: "#0f0f0f" }}>
          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Choose a product per group from its current label. Nothing is chosen for you and nothing is taken from the
            weed catalog. Quantities appear only once a verified label, a rate, a treated area and a tank are all present.
          </p>

          {loadError && <div className="text-[11px] text-amber-400">Saved treatments could not be loaded ({loadError}).</div>}

          <ul className="space-y-2">
            {resolved.map(g => {
              const q = result.groups.find(x => x.key === g.key)!;
              const relevant = choices.filter(c => matchesGroup(c, g.key));
              const others = choices.filter(c => !matchesGroup(c, g.key));
              return (
                <li key={g.key} className="border border-[#1f1f1f] rounded-sm p-2 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-neutral-200 truncate">{g.label}</div>
                      <div className="text-[10px] text-neutral-500">{g.zoneCount} zone{g.zoneCount === 1 ? "" : "s"}, {fmtArea(g.areaM2, units).text}</div>
                    </div>
                    <button type="button" onClick={() => setFormFor({ groupKey: g.key, groupLabel: g.label, editing: null })}
                      className="shrink-0 inline-flex items-center gap-1 text-[10px] border border-[#333] rounded-sm px-1.5 py-0.5 text-neutral-300 hover:bg-[#1f1f1f]">
                      <Plus className="h-3 w-3" /> New
                    </button>
                  </div>
                  <select className={INPUT} value={g.choice?.id ?? ""} onChange={e => assign(g.key, g.label, e.target.value || null)}>
                    <option value="">No product chosen</option>
                    {relevant.length > 0 && <optgroup label="Saved for this weed">{relevant.map(c => <option key={c.id} value={c.id}>{describeChoice(c)}</option>)}</optgroup>}
                    {others.length > 0 && <optgroup label="Other saved treatments">{others.map(c => <option key={c.id} value={c.id}>{describeChoice(c)}</option>)}</optgroup>}
                  </select>
                  {g.choice && (
                    <div className="text-[10px] text-neutral-500 space-y-0.5">
                      <div>{g.choice.epa_reg_no ? `EPA Reg. No. ${g.choice.epa_reg_no}. ` : "No registration number recorded. "}
                        Label {g.choice.label_verified ? `checked ${g.choice.label_checked_on}` : "not verified"}{g.choice.label_crop ? ` for ${g.choice.label_crop}` : ""}.</div>
                      {g.choice.restrictions && <div>Restrictions: {g.choice.restrictions}</div>}
                      <button type="button" className="underline hover:text-neutral-300" onClick={() => setFormFor({ groupKey: g.key, groupLabel: g.label, editing: g.choice })}>Edit this treatment</button>
                    </div>
                  )}
                  {q.kind === "calculated" ? (
                    <div className="text-[11px] text-neutral-200 font-mono">
                      {amountText(q.productAmount, q.productUnit)} product, {fmtVolume(q.sprayVolumeL, units, 1).text} spray
                      <span className="text-neutral-500 font-sans"> ({q.carrierSource === "planner" ? "carrier from planner setting" : "carrier from label"})</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-amber-400/90">
                      <div className="font-semibold">{NOT_CALCULATED}</div>
                      <ul className="text-[10px] text-neutral-400 list-disc pl-4">{q.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-[#222] pt-2 space-y-1">
            {result.total ? (
              <>
                {result.total.products.map(p => (
                  <div key={`${p.name}-${p.unit}`} className="flex justify-between"><span className="text-neutral-500">{p.name}</span>
                    <span className="font-mono text-cyan-300">{amountText(p.amount, p.unit)}</span></div>
                ))}
                <div className="flex justify-between"><span className="text-neutral-500">Total spray volume</span>
                  <span className="font-mono text-cyan-300">{fmtVolume(result.total.sprayVolumeL, units, 1).text}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Tank loads</span>
                  <span className="font-mono">{result.total.loads} x {fmtVolume(result.total.perLoadL, units, 0).text}
                    {result.total.loads > 1 && <span className="text-neutral-500"> (last {fmtVolume(result.total.lastLoadL, units, 1).text})</span>}</span></div>
              </>
            ) : (
              <div className="text-[11px]">
                <div className="text-amber-400/90 font-semibold inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {NOT_CALCULATED} for the job</div>
                <ul className="text-[10px] text-neutral-400 list-disc pl-4 mt-1">{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
            <details className="text-[10px] text-neutral-500">
              <summary className="cursor-pointer">Assumptions</summary>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">{result.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </details>
          </div>
        </div>
      )}

      {formFor && user && (
        <TreatmentChoiceDialog
          userId={user.id}
          fieldId={fieldId}
          fieldCrop={fieldCrop}
          groupKey={formFor.groupKey}
          groupLabel={formFor.groupLabel}
          editing={formFor.editing}
          onClose={() => setFormFor(null)}
          onSaved={async (c) => {
            await reload();
            assign(formFor.groupKey, formFor.groupLabel, c.id);
            setFormFor(null);
          }}
          onDeleted={async () => { await reload(); assign(formFor.groupKey, formFor.groupLabel, null); setFormFor(null); }}
        />
      )}
    </div>
  );
}

function matchesGroup(c: TreatmentChoice, key: string): boolean {
  if (key.startsWith("catalog:")) return c.weed_catalog_id === key.slice("catalog:".length);
  if (key.startsWith("label:")) return !!c.weed_label && c.weed_label.trim().toLowerCase().replace(/\s+/g, " ") === key.slice("label:".length);
  return !c.weed_catalog_id && !c.weed_label;
}

function describeChoice(c: TreatmentChoice): string {
  const rate = c.rate_value != null && c.rate_unit ? `${c.rate_value} ${c.rate_unit}` : "no rate";
  const who = c.weed_label ? ` for ${c.weed_label}` : "";
  return `${c.product_name}${who}, ${rate}${c.label_verified ? "" : " (label not verified)"}`;
}

function TreatmentChoiceDialog({
  userId, fieldId, fieldCrop, groupKey, groupLabel, editing, onClose, onSaved, onDeleted,
}: {
  userId: string; fieldId: string | null; fieldCrop: string | null; groupKey: string; groupLabel: string;
  editing: TreatmentChoice | null; onClose: () => void; onSaved: (c: TreatmentChoice) => Promise<void>; onDeleted: () => Promise<void>;
}) {
  const isCatalog = groupKey.startsWith("catalog:");
  const isLabel = groupKey.startsWith("label:");
  const [draft, setDraft] = useState<TreatmentChoice>(() => editing ?? {
    id: "", weed_catalog_id: isCatalog ? groupKey.slice("catalog:".length) : null,
    weed_label: isCatalog || isLabel ? groupLabel : null,
    product_name: "", epa_reg_no: null, label_source: null, label_checked_on: null, label_crop: fieldCrop,
    application_method: "aerial", restrictions: null, rate_value: null, rate_unit: "L/ha", carrier_volume_value: null,
    carrier_unit: "L/ha", label_verified: false, notes: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = choiceProblems(draft, { fieldCrop });
  const set = <K extends keyof TreatmentChoice>(k: K, v: TreatmentChoice[K]) => setDraft(d => ({ ...d, [k]: v }));
  const num = (v: string): number | null => { const n = Number(v); return v.trim() === "" || !Number.isFinite(n) ? null : n; };

  const save = async () => {
    setSaving(true); setError(null);
    const r = await saveTreatmentChoice(userId, { ...draft, field_id: fieldId }, editing?.id);
    setSaving(false);
    if ("error" in r) { setError(r.error); return; }
    await onSaved(r.choice);
  };
  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    const err = await deleteTreatmentChoice(editing.id);
    setSaving(false);
    if (err) { setError(err); return; }
    await onDeleted();
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg bg-[#161616] text-[#f0f0f0] border-[#222]">
        <DialogHeader>
          <DialogTitle className="text-sm">{editing ? "Edit treatment" : "New treatment"} for {groupLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Copy these from the product's current label. There is no correct product or amount for a weed on file
            anywhere in this app; what you enter here is your decision, recorded with its source.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><label className={LABEL}>Product name</label>
              <input className={INPUT} value={draft.product_name} onChange={e => set("product_name", e.target.value)} placeholder="As printed on the label" /></div>
            <div><label className={LABEL}>EPA registration number</label>
              <input className={INPUT} value={draft.epa_reg_no ?? ""} onChange={e => set("epa_reg_no", e.target.value || null)} placeholder="e.g. 524-537" /></div>
            <div><label className={LABEL}>Label checked on</label>
              <input type="date" className={INPUT} value={draft.label_checked_on ?? ""} onChange={e => set("label_checked_on", e.target.value || null)} /></div>
            <div className="col-span-2"><label className={LABEL}>Label source</label>
              <input className={INPUT} value={draft.label_source ?? ""} onChange={e => set("label_source", e.target.value || null)} placeholder="Label URL, or where the paper label is filed" /></div>
            <div><label className={LABEL}>Crop on the label</label>
              <input className={INPUT} value={draft.label_crop ?? ""} onChange={e => set("label_crop", e.target.value || null)} placeholder={fieldCrop ?? "crop"} /></div>
            <div><label className={LABEL}>Application method</label>
              <input className={INPUT} value={draft.application_method ?? ""} onChange={e => set("application_method", e.target.value || null)} placeholder="aerial" /></div>
            <div><label className={LABEL}>Rate</label>
              <div className="flex gap-1">
                <input type="number" min={0} step="any" className={INPUT} value={draft.rate_value ?? ""} onChange={e => set("rate_value", num(e.target.value))} />
                <select className={INPUT} value={draft.rate_unit ?? ""} onChange={e => set("rate_unit", e.target.value as RateUnit)}>
                  {RATE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div></div>
            <div><label className={LABEL}>Carrier volume (if the label states one)</label>
              <div className="flex gap-1">
                <input type="number" min={0} step="any" className={INPUT} value={draft.carrier_volume_value ?? ""} onChange={e => set("carrier_volume_value", num(e.target.value))} />
                <select className={INPUT} value={draft.carrier_unit ?? ""} onChange={e => set("carrier_unit", e.target.value as CarrierUnit)}>
                  {CARRIER_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div></div>
            <div className="col-span-2"><label className={LABEL}>Restrictions (as on the label)</label>
              <input className={INPUT} value={draft.restrictions ?? ""} onChange={e => set("restrictions", e.target.value || null)} placeholder="Buffer zones, wind limits, re-entry, pre-harvest interval" /></div>
            <div className="col-span-2"><label className={LABEL}>Notes</label>
              <input className={INPUT} value={draft.notes ?? ""} onChange={e => set("notes", e.target.value || null)} /></div>
          </div>
          <label className="flex items-start gap-2 text-[11px] text-neutral-300 cursor-pointer">
            <input type="checkbox" checked={draft.label_verified} onChange={e => set("label_verified", e.target.checked)} className="mt-0.5 accent-[#4CAF50]" />
            I read the current label for this product and it covers this crop, this location, this application method and this rate.
          </label>
          {problems.length > 0 && (
            <div className="text-[10px] text-neutral-500">
              Until these are filled in, the planner shows "{NOT_CALCULATED}" for this group:
              <ul className="list-disc pl-4">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {editing && <button type="button" onClick={remove} disabled={saving} className="text-[11px] underline text-neutral-500 hover:text-red-400">Delete</button>}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="text-[11px] border border-[#333] rounded-sm px-3 py-1.5 text-neutral-300 hover:bg-[#1f1f1f]">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !draft.product_name.trim()}
                className="inline-flex items-center gap-1.5 text-[11px] bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 text-black rounded-sm px-3 py-1.5 font-semibold">
                {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save treatment
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
