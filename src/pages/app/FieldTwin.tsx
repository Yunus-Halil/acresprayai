// Swardus Field Twin (prototype, under review): a field as vectors, built straight from the original drone
// photographs. This page is the shell: which twin the account holds, saving one from files or (in a development
// build) from the twin built on this computer, and the account's scans offered as developer-only reference
// imagery. The viewer itself is components/app/fieldTwin/FieldTwinView.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { nativeZoomFor } from "@/lib/bakedZoom";
import { type ComparableScan, isComparable, rgbTileUrl } from "@/lib/scanLayers";
import { isFieldTwinReviewer } from "@/lib/fieldTwin/reviewers";
import { type SavedTwin, listTwins, loadAtlas, loadTwin, missingFiles, saveTwin } from "@/lib/fieldTwin/store";
import { type TwinBundle, parseTwin } from "@/lib/fieldTwin/types";
import FieldTwinView, { type ReferenceOption } from "@/components/app/fieldTwin/FieldTwinView";

const btn = "inline-flex items-center gap-1.5 text-xs border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40 rounded-sm px-2.5 py-1";

/** Where the open twin's atlases come from: the account, the dev server, or files just picked. */
type Source = { kind: "account"; userId: string } | { kind: "dev" } | { kind: "files"; files: Map<string, Blob> };

type ScanRow = ComparableScan & { image_count: number | null; tiles_max_zoom: number | null; field_id: string };

export default function FieldTwin() {
  const { user, session } = useAuth();
  const reviewer = isFieldTwinReviewer(user?.email);
  const userId = user?.id ?? null;
  const token = session?.access_token ?? null;
  const [saved, setSaved] = useState<SavedTwin[] | null>(null);
  const [devTwins, setDevTwins] = useState<string[]>([]);
  const [twin, setTwin] = useState<TwinBundle | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Map<string, Promise<string>>());

  const refresh = useCallback(async () => {
    if (!userId) return;
    try { setSaved(await listTwins(userId)); } catch (e) { setError(`Could not list saved twins: ${(e as Error).message}`); setSaved([]); }
  }, [userId]);
  useEffect(() => { if (reviewer) void refresh(); }, [reviewer, refresh]);
  useEffect(() => {
    if (!reviewer || !import.meta.env.DEV) return;
    fetch("/__field-twin/").then(r => (r.ok ? r.json() : [])).then(ids => setDevTwins(Array.isArray(ids) ? ids : [])).catch(() => setDevTwins([]));
  }, [reviewer]);
  // The account's scans with baked tiles: candidates for the reference layer. Which one is this twin's flight is
  // for the reviewer to judge by its date and photo count; the page cannot know.
  useEffect(() => {
    if (!reviewer || !userId) return;
    let live = true;
    supabase.from("odm_tasks").select("id, odm_uuid, status, created_at, image_count, tiles_baked, tiles_max_zoom, field_id").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => { if (live) setScans(((data as ScanRow[] | null) ?? []).filter(isComparable)); });
    return () => { live = false; };
  }, [reviewer, userId]);

  const open = (t: TwinBundle, s: Source) => {
    for (const p of urls.current.values()) void p.then(u => { if (u.startsWith("blob:")) URL.revokeObjectURL(u); }).catch(() => undefined);
    urls.current.clear();
    setTwin(t); setSource(s); setError(null);
  };
  const atlasUrl = useCallback((index: number): Promise<string> => {
    if (!twin || !source) return Promise.reject(new Error("no twin open"));
    const file = twin.atlases[index]?.file;
    if (!file) return Promise.reject(new Error(`no atlas ${index}`));
    let p = urls.current.get(file);
    if (!p) {
      p = source.kind === "account" ? loadAtlas(source.userId, twin.id, file)
        : source.kind === "dev" ? Promise.resolve(`/__field-twin/${twin.id}/${file}`)
        : Promise.resolve(URL.createObjectURL(source.files.get(file)!));
      urls.current.set(file, p);
    }
    return p;
  }, [twin, source]);

  const openSaved = async (id: string) => {
    if (!userId) return;
    setBusy("Opening the twin…"); setError(null);
    try { open(await loadTwin(userId, id), { kind: "account", userId }); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const devFiles = async (id: string): Promise<{ twin: TwinBundle; files: Map<string, Blob> }> => {
    const blob = await (await fetch(`/__field-twin/${id}/twin.json`)).blob();
    const parsed = parseTwin(JSON.parse(await blob.text()));
    if ("reason" in parsed) throw new Error(parsed.reason);
    const files = new Map<string, Blob>([["twin.json", blob]]);
    for (const a of parsed.twin.atlases) files.set(a.file, await (await fetch(`/__field-twin/${id}/${a.file}`)).blob());
    return { twin: parsed.twin, files };
  };
  const saveFromDev = async (id: string) => {
    if (!userId) return;
    setError(null);
    try {
      setBusy("Reading the twin built on this computer…");
      const { twin: t, files } = await devFiles(id);
      await saveTwin(userId, t, files, (d, n) => setBusy(`Saving to your account: ${d} of ${n} files`));
      await refresh();
      open(t, { kind: "account", userId });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const viewFromDev = async (id: string) => {
    setBusy("Opening…"); setError(null);
    try {
      const parsed = parseTwin(await (await fetch(`/__field-twin/${id}/twin.json`)).json());
      if ("reason" in parsed) throw new Error(parsed.reason);
      open(parsed.twin, { kind: "dev" });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const fromFiles = async (list: FileList | null) => {
    if (!list || !userId) return;
    setError(null);
    const files = new Map<string, Blob>([...list].map(f => [f.name, f]));
    const json = files.get("twin.json");
    if (!json) { setError("Pick twin.json together with its atlas-N.jpg files."); return; }
    try {
      const parsed = parseTwin(JSON.parse(await json.text()));
      if ("reason" in parsed) throw new Error(parsed.reason);
      const missing = missingFiles(parsed.twin, [...files.keys()]);
      if (missing.length) throw new Error(`These files are missing from the selection: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}`);
      await saveTwin(userId, parsed.twin, files, (d, n) => setBusy(`Saving to your account: ${d} of ${n} files`));
      await refresh();
      open(parsed.twin, { kind: "account", userId });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); if (fileInput.current) fileInput.current.value = ""; }
  };

  if (!reviewer) {
    return (
      <div className="p-8 max-w-xl text-sm text-neutral-300">
        <h1 className="font-display text-2xl mb-2">Field Twin</h1>
        <p>The Field Twin is a prototype under review and is not open on this account yet.</p>
      </div>
    );
  }

  const referenceOptions: ReferenceOption[] = token ? scans.map(s => {
    const url = rgbTileUrl(s, token);
    const when = new Date(s.created_at).toLocaleDateString();
    return url ? { id: s.id, label: `Scan of ${when}, ${s.image_count ?? "?"} photographs`, url, maxNativeZoom: nativeZoomFor(s.tiles_max_zoom, null), note: `Source: this account's ODM orthomosaic from the scan of ${when} (${s.image_count ?? "?"} photographs). Its positional accuracy is unverified. Built from the same flight, it is a consistency check, not independent ground truth. Display only: it never moves the twin's objects.` } : null;
  }).filter((x): x is ReferenceOption => !!x) : [];

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-[#262626] bg-[#121212] px-3 py-1.5 text-sm">
        <h1 className="font-display text-base mr-2">Field Twin</h1>
        <label className="text-xs text-neutral-400">Twin
          <select className="ml-1.5 rounded-sm border border-[#333] bg-[#0f0f0f] px-1.5 py-1 text-xs text-neutral-200" value={twin && source?.kind === "account" ? twin.id : ""} onChange={e => e.target.value && void openSaved(e.target.value)} disabled={!!busy} aria-label="Saved twins">
            <option value="">{saved == null ? "Loading…" : saved.length ? "Choose a saved twin" : "None saved to this account yet"}</option>
            {(saved ?? []).map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
          </select>
        </label>
        {import.meta.env.DEV && devTwins.map(id => (
          <span key={id} className="flex items-center gap-1">
            <span className="text-[11px] text-neutral-500">Built here: {id}</span>
            <button className={btn} onClick={() => void saveFromDev(id)} disabled={!!busy}><Upload className="h-3 w-3" />Save to my account</button>
            <button className={btn} onClick={() => void viewFromDev(id)} disabled={!!busy}>View only</button>
          </span>
        ))}
        <input ref={fileInput} type="file" multiple accept=".json,.jpg,image/jpeg,application/json" className="hidden" onChange={e => void fromFiles(e.target.files)} />
        <button className={btn} onClick={() => fileInput.current?.click()} disabled={!!busy}><Upload className="h-3 w-3" />Add a twin from files</button>
        {busy && <span className="flex items-center gap-1.5 text-xs text-neutral-300"><Loader2 className="h-3.5 w-3.5 animate-spin" />{busy}</span>}
        {error && <span className="flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}</span>}
        {twin && <span className="ml-auto text-[11px] text-neutral-500">{twin.source.photographs} photographs · {twin.source.camera} · built {new Date(twin.builtAt).toLocaleDateString()} · no orthomosaic</span>}
      </header>
      <main className="relative min-h-0 flex-1">
        {twin ? <FieldTwinView twin={twin} atlasUrl={atlasUrl} referenceOptions={referenceOptions} expose={import.meta.env.DEV} />
          : <div className="grid h-full place-items-center text-sm text-neutral-500">Choose a twin to see the field.</div>}
      </main>
    </div>
  );
}
