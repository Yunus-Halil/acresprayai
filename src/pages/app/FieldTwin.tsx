// Swardus Field Twin (prototype, under review): a field as vectors, built straight from the original drone
// photographs. Trees, crop rows, weed candidates and other vegetation, each measured in the photographs and each
// with the crops of the photographs that show it. No satellite layer, no orthomosaic.
//
// A twin is built on a computer by scripts/directGeoref/buildTwin.ts and saved to the account's own private storage
// (lib/fieldTwin/store.ts); this page reads it back. The page is listed for the reviewers in lib/fieldTwin/reviewers.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Layers, Loader2, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtDistance, fmtLengthCm } from "@/lib/units";
import { isFieldTwinReviewer } from "@/lib/fieldTwin/reviewers";
import { type SavedTwin, bundleFileNames, listTwins, loadAtlas, loadTwin, missingFiles, saveTwin } from "@/lib/fieldTwin/store";
import { type TwinBundle, parseTwin } from "@/lib/fieldTwin/types";
import { type DetailLevel, OUTLINES_FROM_ZOOM, POINTS_FROM_ZOOM } from "@/lib/fieldTwin/view";
import TwinMap, { type TwinSelection } from "@/components/app/fieldTwin/TwinMap";
import { DEFAULT_LAYERS, ROW_COLOUR, TREE_COLOUR, type TwinLayers, WEED_COLOUR } from "@/lib/fieldTwin/style";
import TwinInspector from "@/components/app/fieldTwin/TwinInspector";

const btn = "inline-flex items-center gap-1.5 text-xs border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40 rounded-sm px-3 py-1.5";

/** Where the open twin's atlases come from: the account, the dev server, or files just picked. */
type Source = { kind: "account"; userId: string } | { kind: "dev" } | { kind: "files"; files: Map<string, Blob> };

export default function FieldTwin() {
  const { user } = useAuth();
  const units = useUnitSystem();
  const reviewer = isFieldTwinReviewer(user?.email);
  const [saved, setSaved] = useState<SavedTwin[] | null>(null);
  const [devTwins, setDevTwins] = useState<string[]>([]);
  const [twin, setTwin] = useState<TwinBundle | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<TwinLayers>(DEFAULT_LAYERS);
  const [selection, setSelection] = useState<TwinSelection>(null);
  const [detail, setDetail] = useState<{ level: DetailLevel; zoom: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Map<string, Promise<string>>());

  // Keyed on the id, not the user object: a new object for the same account must not list the twins again.
  const userId = user?.id ?? null;
  const refresh = useCallback(async () => {
    if (!userId) return;
    try { setSaved(await listTwins(userId)); } catch (e) { setError(`Could not list saved twins: ${(e as Error).message}`); setSaved([]); }
  }, [userId]);

  useEffect(() => { if (reviewer) void refresh(); }, [reviewer, refresh]);
  useEffect(() => {
    if (!reviewer || !import.meta.env.DEV) return;
    fetch("/__field-twin/").then(r => (r.ok ? r.json() : [])).then(ids => setDevTwins(Array.isArray(ids) ? ids : [])).catch(() => setDevTwins([]));
  }, [reviewer]);

  const open = (t: TwinBundle, s: Source) => {
    for (const p of urls.current.values()) void p.then(u => { if (u.startsWith("blob:")) URL.revokeObjectURL(u); }).catch(() => undefined);
    urls.current.clear();
    setSelection(null); setTwin(t); setSource(s); setError(null);
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
    if (!user) return;
    setBusy("Opening the twin…"); setError(null);
    try { open(await loadTwin(user.id, id), { kind: "account", userId: user.id }); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const devFiles = async (id: string): Promise<{ twin: TwinBundle; files: Map<string, Blob> }> => {
    const res = await fetch(`/__field-twin/${id}/twin.json`);
    const blob = await res.blob();
    const parsed = parseTwin(JSON.parse(await blob.text()));
    if ("reason" in parsed) throw new Error(parsed.reason);
    const files = new Map<string, Blob>([["twin.json", blob]]);
    for (const a of parsed.twin.atlases) files.set(a.file, await (await fetch(`/__field-twin/${id}/${a.file}`)).blob());
    return { twin: parsed.twin, files };
  };

  const saveFromDev = async (id: string) => {
    if (!user) return;
    setError(null);
    try {
      setBusy("Reading the twin built on this computer…");
      const { twin: t, files } = await devFiles(id);
      await saveTwin(user.id, t, files, (d, n) => setBusy(`Saving to your account: ${d} of ${n} files`));
      await refresh();
      open(t, { kind: "account", userId: user.id });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const viewFromDev = async (id: string) => {
    setBusy("Opening…"); setError(null);
    try {
      const res = await fetch(`/__field-twin/${id}/twin.json`);
      const parsed = parseTwin(await res.json());
      if ("reason" in parsed) throw new Error(parsed.reason);
      open(parsed.twin, { kind: "dev" });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const fromFiles = async (list: FileList | null) => {
    if (!list || !user) return;
    setError(null);
    const files = new Map<string, Blob>([...list].map(f => [f.name, f]));
    const json = files.get("twin.json");
    if (!json) { setError("Pick twin.json together with its atlas-N.jpg files."); return; }
    try {
      const parsed = parseTwin(JSON.parse(await json.text()));
      if ("reason" in parsed) throw new Error(parsed.reason);
      const missing = missingFiles(parsed.twin, [...files.keys()]);
      if (missing.length) throw new Error(`These files are missing from the selection: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}`);
      await saveTwin(user.id, parsed.twin, files, (d, n) => setBusy(`Saving to your account: ${d} of ${n} files`));
      await refresh();
      open(parsed.twin, { kind: "account", userId: user.id });
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

  const counts = twin && {
    verified: twin.weeds.filter(w => w.status === "verified").length,
    between: twin.weeds.filter(w => w.status === "verified" && w.rowStatus === "between rows").length,
    single: twin.weeds.filter(w => w.status === "single view").length,
    onTree: twin.weeds.filter(w => w.status === "on a tree").length,
    rows: twin.rows.filter(r => r.kept).length,
    dropped: twin.rows.filter(r => !r.kept).length,
  };
  const toggle = (k: keyof TwinLayers, label: string, swatch: string, n?: number) => (
    <label key={k} className="flex items-center gap-2 text-xs text-neutral-300 py-0.5 cursor-pointer">
      <input type="checkbox" checked={layers[k]} onChange={e => setLayers(l => ({ ...l, [k]: e.target.checked }))} />
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: swatch }} />
      {label}{n != null ? <span className="text-neutral-500">({n.toLocaleString()})</span> : null}
    </label>
  );

  return (
    <div className="flex h-[calc(100vh-0px)] min-h-0">
      <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-[#262626] bg-[#121212] p-4 text-sm">
        <h1 className="font-display text-xl">Field Twin</h1>
        <p className="mt-1 text-xs text-neutral-400">Built straight from the original drone photographs: no orthomosaic, no satellite image. Every object below was measured in the photographs and can be opened to see them.</p>

        <h2 className="mt-4 mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Your twins</h2>
        {saved == null ? <p className="text-xs text-neutral-500">Loading…</p> : saved.length === 0 ? <p className="text-xs text-neutral-500">None saved to this account yet.</p> : (
          <ul className="space-y-1">{saved.map(s => (
            <li key={s.id}><button className={btn} onClick={() => void openSaved(s.id)} disabled={!!busy}>{s.id}</button></li>
          ))}</ul>
        )}
        {import.meta.env.DEV && devTwins.length > 0 && (
          <>
            <h2 className="mt-4 mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Built on this computer</h2>
            <ul className="space-y-1.5">{devTwins.map(id => (
              <li key={id} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-neutral-300 mr-1">{id}</span>
                <button className={btn} onClick={() => void saveFromDev(id)} disabled={!!busy}><Upload className="h-3.5 w-3.5" />Save to my account</button>
                <button className={btn} onClick={() => void viewFromDev(id)} disabled={!!busy}>View only</button>
              </li>
            ))}</ul>
          </>
        )}
        <div className="mt-3">
          <input ref={fileInput} type="file" multiple accept=".json,.jpg,image/jpeg,application/json" className="hidden" onChange={e => void fromFiles(e.target.files)} />
          <button className={btn} onClick={() => fileInput.current?.click()} disabled={!!busy}><Upload className="h-3.5 w-3.5" />Add a twin from files (twin.json + atlas files)</button>
        </div>
        {busy && <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-300"><Loader2 className="h-3.5 w-3.5 animate-spin" />{busy}</p>}
        {error && <p className="mt-2 flex items-start gap-1.5 text-xs text-red-400"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{error}</p>}

        {twin && counts && (
          <>
            <h2 className="mt-5 mb-1 text-[11px] uppercase tracking-wide text-neutral-500 flex items-center gap-1"><Layers className="h-3 w-3" />Layers</h2>
            {toggle("rows", "Crop rows", ROW_COLOUR, counts.rows)}
            {toggle("trees", "Trees", TREE_COLOUR, twin.trees.length)}
            {toggle("inferred", "Inferred tree positions (pattern, dashed)", TREE_COLOUR, twin.inferredTrees.length)}
            {toggle("verified", "Weed candidates, verified (2+ photos)", WEED_COLOUR.betweenRows, counts.verified)}
            {toggle("singleView", "Weed candidates, seen in one photo only", WEED_COLOUR.single, counts.single)}
            {toggle("onTree", "Model detections on tree crowns", WEED_COLOUR.onTree, counts.onTree)}
            {toggle("vegetation", "Other vegetation", "#86efac", twin.vegetation.length)}
            {toggle("droppedRows", "Row candidates not kept", "#6b7280", counts.dropped)}
            {toggle("coverage", "Photo coverage", "#6b7280")}
            <p className="mt-2 text-[11px] text-neutral-500">
              {detail?.level === "overview" ? `Zoomed out: weeds as a density grid (5 m squares). Zoom in past ${POINTS_FROM_ZOOM} for points, past ${OUTLINES_FROM_ZOOM} for outlines.` : detail?.level === "points" ? `Points. Zoom in past ${OUTLINES_FROM_ZOOM} for crowns and weed outlines.` : "Outlines as measured. Click anything to inspect it."}
              {detail ? ` (zoom ${detail.zoom.toFixed(1)})` : ""}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500"><span style={{ color: WEED_COLOUR.betweenRows }}>●</span> between rows <span style={{ color: WEED_COLOUR.onRow }} className="ml-2">●</span> on a row</p>

            <h2 className="mt-5 mb-1 text-[11px] uppercase tracking-wide text-neutral-500">Inspect</h2>
            <TwinInspector twin={twin} selection={selection} atlasUrl={atlasUrl} />

            <h2 className="mt-5 mb-1 text-[11px] uppercase tracking-wide text-neutral-500">This twin</h2>
            <dl className="space-y-0.5 text-xs">
              {[
                ["Photographs", String(twin.source.photographs)],
                ["Camera", twin.source.camera],
                ["Ground pixel", fmtLengthCm(twin.source.groundPixelCm, units).text],
                ["Rows", `${counts.rows}, ${fmtDistance(twin.field.rowSpacingM, units).text} apart`],
                ["Trees along a row", `${fmtDistance(twin.field.plantSpacingM, units).text} apart`],
                ["Verified weed candidates", `${counts.verified.toLocaleString()} (${counts.between.toLocaleString()} between rows)`],
              ].map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-neutral-500">{k}</dt><dd className="text-right text-neutral-200">{v}</dd></div>)}
            </dl>
            <p className="mt-2 text-[11px] text-neutral-500">{twin.source.method}. Weeds: {twin.source.weedModel}. Trees: {twin.source.treeModel}. Bundle files: {bundleFileNames(twin).length}.</p>
          </>
        )}
      </aside>
      <main className="relative min-w-0 flex-1">
        {twin ? <TwinMap twin={twin} layers={layers} selection={selection} onSelect={setSelection} onDetail={(level, zoom) => setDetail({ level, zoom })} />
          : <div className="grid h-full place-items-center text-sm text-neutral-500">Open a twin to see the field.</div>}
      </main>
    </div>
  );
}
