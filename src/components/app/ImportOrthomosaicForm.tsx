// The second way to start a field: import an already-finished GeoTIFF
// orthomosaic instead of flying and uploading raw drone images.
//
// The file already knows where it is, so no boundary drawing is required
// here — that stays available afterward in Field View, exactly as it is for
// every other field, to narrow the scan area if the operator wants to.
//
// Refuses at the door, not three screens later: readOrthoMetadata (lib/
// orthoImport.ts) reads the file's own header and stops on anything the rest
// of the pipeline could not honestly render.
//
// Band count is assumed where there is only one sensible answer and asked
// where there is not (bandsNeedMapping): three bands are R, G, B in file
// order, four are that plus an alpha mask, which is what OpenDroneMap itself
// writes. Five or more is a multispectral capture whose first three bands are
// not R, G and B, and that one a person has to answer. The assumption is
// always stated and always overridable, so nothing is silently misread.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  type ImportPhase, type OrthoBandMapping, type OrthoMetadata,
  bandsNeedMapping, defaultThreeBandMapping, hasAlphaBand, readOrthoMetadata, runOrthoImport,
} from "@/lib/orthoImport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowRight, CheckCircle2, FileUp, Loader2, Settings2 } from "lucide-react";

const PHASE_LABEL: Record<ImportPhase, string> = {
  uploading: "Uploading the orthomosaic…",
  finishing: "Finishing the import…",
  done: "Done.",
};

export default function ImportOrthomosaicForm({ onImported, existingField }: {
  onImported: (fieldId: string) => void;
  /**
   * Import into a field that already exists, rather than creating one.
   *
   * The failure path below has always told the operator to "open the field and
   * retry the import from there", which was advice with nowhere to go: this
   * form only existed on the create-a-field dialog. It is also simply where
   * the job lives. Someone who has made a field and is looking at "upload
   * drone images for this field" is in exactly the place where handing over a
   * finished orthomosaic instead should be an option.
   */
  existingField?: { id: string; name: string } | null;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", location: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [meta, setMeta] = useState<OrthoMetadata | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [mapping, setMapping] = useState<OrthoBandMapping | null>(null);
  const [customizeMapping, setCustomizeMapping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ImportPhase | null>(null);

  const needsMapping = !!meta && bandsNeedMapping(meta.bandCount);
  const bandOptions = useMemo(
    () => (meta ? Array.from({ length: meta.bandCount }, (_, i) => i + 1) : []),
    [meta],
  );
  const mappingComplete = !!mapping && mapping.red > 0 && mapping.green > 0 && mapping.blue > 0;
  const mappingDistinct = !!mapping && new Set([mapping.red, mapping.green, mapping.blue]).size === 3;

  const pickFile = async (f: File | null) => {
    setFile(f);
    setMeta(null);
    setRefusal(null);
    setMapping(null);
    setCustomizeMapping(false);
    if (!f) return;
    setChecking(true);
    try {
      const result = await readOrthoMetadata(f);
      // strict:false in this project's tsconfig means a boolean-literal `ok`
      // discriminant does not narrow the union; test for the refusal's own
      // field instead (same pattern as saveObservation's result elsewhere).
      if ("reason" in result) {
        setRefusal(result.reason);
      } else {
        setMeta(result);
        setMapping(bandsNeedMapping(result.bandCount) ? null : defaultThreeBandMapping());
      }
    } catch (e) {
      setRefusal(`Could not read this file: ${(e as Error)?.message ?? e}`);
    } finally {
      setChecking(false);
    }
  };

  const setBand = (role: "red" | "green" | "blue", band: number) => {
    setMapping(m => ({ ...(m ?? { red: 0, green: 0, blue: 0 }), [role]: band }));
  };

  const canSubmit = !!user && !!file && !!meta && !checking && !busy &&
    (!!existingField || form.name.trim().length > 0) && mappingComplete && mappingDistinct;

  const submit = async () => {
    if (!canSubmit || !file || !meta || !mapping || !user) return;
    setBusy(true);
    let fieldId: string | null = existingField?.id ?? null;
    try {
      let fieldName = existingField?.name ?? "";
      if (!existingField) {
        const { data, error } = await supabase.from("fields").insert({
          user_id: user.id, name: form.name.trim(), crop: "",
          area_hectares: 0,
          location: form.location.trim() || null, notes: form.notes.trim() || null,
        }).select().single();
        if (error) throw new Error(`Couldn't create the field: ${error.message}`);
        fieldId = data.id;
        fieldName = data.name;
      }

      await runOrthoImport({ fieldId: fieldId!, file, metadata: meta, mapping, onProgress: setPhase });

      toast.success(`Imported. ${fieldName} is ready to view.`);
      onImported(fieldId!);
    } catch (e) {
      // The field may already exist even though the import failed midway — it
      // is not deleted, so the operator's work (name, location, notes) is not
      // lost and they can open the field and retry the import from there.
      toast.error(e instanceof Error ? e.message : "Import failed", {
        description: fieldId && !existingField ? "The field was created; open it to retry the import." : undefined,
        duration: 8000,
      });
      if (fieldId && !existingField) navigate(`/app/fields/${fieldId}`);
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>GeoTIFF orthomosaic</Label>
        <input
          type="file"
          accept=".tif,.tiff,image/tiff"
          onChange={e => void pickFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
        />
        <p className="text-xs text-muted-foreground mt-1">
          We read the CRS, geotransform and bounds straight from the file, so no boundary drawing is needed to start.
          You can still draw one afterward in Field View to narrow the scan area.
        </p>
      </div>

      {checking && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the file…
        </div>
      )}

      {refusal && (
        <div className="flex items-start gap-2 text-sm bg-destructive/10 border border-destructive/30 text-destructive p-3 rounded">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>{refusal}</div>
        </div>
      )}

      {meta && (
        <div className="rounded border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> What we read
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Dimensions</dt>
            <dd className="font-mono">{meta.widthPx.toLocaleString()} × {meta.heightPx.toLocaleString()} px</dd>
            <dt className="text-muted-foreground">GSD</dt>
            <dd className="font-mono">{(meta.gsdM * 100).toFixed(2)} cm/px</dd>
            <dt className="text-muted-foreground">CRS</dt>
            <dd className="font-mono">{meta.crsLabel}</dd>
            <dt className="text-muted-foreground">Bands</dt>
            <dd className="font-mono">{meta.bandCount} ({meta.dtype})</dd>
          </dl>

          {!needsMapping && !customizeMapping && (
            <div className="text-xs text-muted-foreground flex items-center justify-between pt-1 border-t mt-2">
              <span>
                {meta.bandCount} bands, assumed R = 1, G = 2, B = 3 (standard camera order)
                {hasAlphaBand(meta.bandCount) ? ", band 4 transparency" : ""}.
              </span>
              <button type="button" className="underline inline-flex items-center gap-1 shrink-0"
                onClick={() => setCustomizeMapping(true)}>
                <Settings2 className="h-3 w-3" /> Not right? Customize
              </button>
            </div>
          )}

          {needsMapping && (
            <div className="text-xs text-amber-700 dark:text-amber-500 flex items-start gap-1.5 pt-1 border-t mt-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                {meta.bandCount} bands. On a multispectral capture the first three are not red, green and
                blue, and reading them as though they were gives plausible-looking, wrong colours (Phantom 4
                Multispectral and similar). Say which band is which before importing.
              </span>
            </div>
          )}

          {(needsMapping || customizeMapping) && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {(["red", "green", "blue"] as const).map(role => (
                <div key={role}>
                  <Label className="text-[11px] capitalize">{role}</Label>
                  <Select
                    value={mapping?.[role] ? String(mapping[role]) : undefined}
                    onValueChange={v => setBand(role, Number(v))}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Band" /></SelectTrigger>
                    <SelectContent>
                      {bandOptions.map(b => <SelectItem key={b} value={String(b)}>Band {b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {mapping && !mappingDistinct && mappingComplete && (
                <div className="col-span-3 text-[11px] text-destructive">Pick three different bands for red, green and blue.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Only when this form is also creating the field. Importing into one
          that exists already has its name and its notes. */}
      {!existingField && (
        <>
          <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="North vineyard" /></div>
          <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="optional" /></div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="optional" /></div>
        </>
      )}

      {phase && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {PHASE_LABEL[phase]}
        </div>
      )}

      <Button type="button" className="w-full" disabled={!canSubmit} onClick={submit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {busy ? "Importing…" : existingField ? "Import into this field" : "Create field & import"} <ArrowRight className="h-4 w-4" />
      </Button>
      <p className="text-xs text-muted-foreground">
        Once imported, this field works exactly like any other: Field View, the Treatment Grid and Weed
        Scout all read this scan the same way they read a scan built from your own drone images.
      </p>
    </div>
  );
}
