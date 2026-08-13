import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Upload, Loader2, AlertCircle, Download, RefreshCcw, Trash2,
  ArrowLeft, Leaf, Pencil, Check, X, Map as MapIcon, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { hasGPS } from "@/lib/imagePrep";
import {
  MAX_IMAGES, MIN_IMAGES, UploadError, type NodeCapabilities, type UploadProgress,
  clearCheckpoint, effectiveMaxImages, fetchNodeCapabilities, readCheckpoint, uploadScan,
} from "@/lib/scanUpload";
import { PAGE_SIZE, appendPage, hasMore, pageRange } from "@/lib/pagination";

type Task = {
  id: string; field_id: string; odm_uuid: string | null;
  status: string; progress: number; image_count: number;
  output_path: string | null; error: string | null; created_at: string;
};

// Statuses where the pipeline is still working and the client should keep
// polling. "mirroring" means an edge worker holds the transfer lease.
const ACTIVE_STATUSES = ["uploading", "queued", "processing", "mirroring"];
type Field = {
  id: string; name: string; crop: string; area_hectares: number;
  location: string | null; notes: string | null; created_at: string;
};

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? `Bearer ${data.session.access_token}` : "";
}

export default function FieldDetail() {
  const { id: fieldId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [field, setField] = useState<Field | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [resumable, setResumable] = useState<{ done: number; total: number } | null>(null);
  const [orthoAvailable, setOrthoAvailable] = useState<Record<string, boolean>>({});
  const [caps, setCaps] = useState<NodeCapabilities | null>(null);
  const [taskPage, setTaskPage] = useState(0);
  const [tasksHasMore, setTasksHasMore] = useState(false);
  const pollRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Surface an interrupted upload so the farmer knows their progress survived.
  useEffect(() => {
    if (!fieldId) return;
    const c = readCheckpoint(fieldId);
    setResumable(c ? { done: c.done.length, total: c.total } : null);
  }, [fieldId, busy]);

  useEffect(() => { void fetchNodeCapabilities().then(setCaps); }, []);
  const maxImages = effectiveMaxImages(caps);

  const loadField = async () => {
    if (!fieldId) return;
    const { data, error } = await supabase.from("fields").select("*").eq("id", fieldId).maybeSingle();
    if (error || !data) { toast.error("Field not found"); navigate("/app/fields"); return; }
    setField(data as Field);
  };
  // Scan history grows one row per flight forever, so it pages. `reload` keeps
  // the pages already on screen and refreshes them in place — the poller calls
  // this every 5s and must not collapse the list back to page one.
  const loadTasks = async (opts: { page?: number; reload?: boolean } = {}) => {
    if (!fieldId) return;
    const targetPage = opts.reload ? 0 : opts.page ?? 0;
    const span = opts.reload
      // Refresh every page currently visible in one request.
      ? [0, (taskPage + 1) * PAGE_SIZE - 1] as [number, number]
      : pageRange(targetPage);
    const { data } = await supabase.from("odm_tasks").select("*")
      .eq("field_id", fieldId)
      .order("created_at", { ascending: false })
      .range(span[0], span[1]);
    const rows = (data as Task[]) ?? [];
    setTasks(prev => (opts.reload || targetPage === 0 ? rows : appendPage(prev, rows)));
    setTasksHasMore(hasMore(rows, span[1] - span[0] + 1));
    if (!opts.reload) setTaskPage(targetPage);
  };
  useEffect(() => { loadField(); loadTasks(); }, [fieldId]);

  // Poll active tasks every 5s
  useEffect(() => {
    const active = tasks.filter(t => ACTIVE_STATUSES.includes(t.status));
    if (active.length === 0) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      const auth = await authHeader();
      await Promise.all(active.map(t => fetch(`${FN_BASE}/odm-poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ task_id: t.id }),
      }).catch(() => {})));
      loadTasks({ reload: true });
    }, 5000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [tasks]);

  // For completed tasks, probe whether an orthomosaic asset exists
  useEffect(() => {
    const completed = tasks.filter(t => t.status === "completed" && t.odm_uuid && !(t.odm_uuid in orthoAvailable));
    if (!completed.length) return;
    (async () => {
      const auth = await authHeader();
      const updates: Record<string, boolean> = {};
      await Promise.all(completed.map(async (t) => {
        try {
          const r = await fetch(`${FN_BASE}/odm-asset?uuid=${t.odm_uuid}&probe=ortho`, {
            headers: { Authorization: auth },
          });
          const j = await r.json();
          updates[t.odm_uuid!] = !!j.available;
        } catch { updates[t.odm_uuid!] = false; }
      }));
      setOrthoAvailable(prev => ({ ...prev, ...updates }));
    })();
  }, [tasks]);

  const submit = async () => {
    if (!fieldId) return;
    if (!files.length) return toast.error("Select drone images first");
    if (files.length < MIN_IMAGES) return toast.error(`Need at least ${MIN_IMAGES} images for reconstruction`);
    if (files.length > maxImages) {
      return toast.error(
        `Your processing node accepts ${maxImages} images per scan. ` +
        `Split this into smaller batches — uploading more would waste data on images it will reject.`,
        { duration: 9000 },
      );
    }

    // Pre-flight: sample a few images for GPS EXIF. Without GPS, ODM produces
    // an ungeoreferenced ortho that lands at lat 0, lng 0 (Atlantic ocean).
    const sample = files.slice(0, Math.min(5, files.length));
    const gpsResults = await Promise.all(sample.map(hasGPS));
    const withGPS = gpsResults.filter(Boolean).length;
    if (withGPS === 0) {
      const proceed = window.confirm(
        "None of the sampled images have GPS EXIF tags.\n\n" +
        "Without GPS, the orthomosaic will NOT be georeferenced and will not display on the map. " +
        "Re-export your drone photos with GPS metadata intact (most drones do this by default; some social/cloud apps strip it).\n\n" +
        "Upload anyway?"
      );
      if (!proceed) return;
    } else if (withGPS < sample.length) {
      toast.warning(`Only ${withGPS}/${sample.length} sampled images have GPS — orthomosaic accuracy may suffer.`);
    }

    setBusy(true);
    abortRef.current = new AbortController();
    try {
      await uploadScan({
        fieldId,
        files,
        signal: abortRef.current.signal,
        onProgress: (p) => {
          setProgress(p);
          // Surface the scan row as soon as it exists so the farmer can see it.
          if (p.done === 1) void loadTasks();
        },
      });
      toast.success("Scan submitted — reconstruction has started. This takes 10 minutes to several hours.");
      setFiles([]);
      loadTasks();
    } catch (e) {
      const resumableErr = e instanceof UploadError ? e.resumable : true;
      toast.error(e instanceof Error ? e.message : "Upload failed", {
        duration: resumableErr ? 10_000 : 6_000,
      });
      loadTasks();
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const pauseUpload = () => {
    abortRef.current?.abort();
    toast.info("Upload paused. Your progress is saved — press Start again to resume.");
  };

  const discardResume = () => {
    if (!fieldId) return;
    clearCheckpoint(fieldId);
    setResumable(null);
    toast.info("Saved upload progress discarded. The next attempt starts fresh.");
  };

  // Ask the server to re-drive a scan that failed or stalled mid-transfer.
  const retryTask = async (t: Task) => {
    const auth = await authHeader();
    await fetch(`${FN_BASE}/odm-poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ task_id: t.id, retry: true }),
    }).catch(() => {});
    toast.info("Retrying this scan.");
    loadTasks();
  };

  const downloadZip = async (t: Task) => {
    if (!t.output_path) return;
    const { data, error } = await supabase.storage.from("scans").createSignedUrl(t.output_path, 60 * 10);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const removeTask = async (id: string) => {
    await supabase.from("odm_tasks").delete().eq("id", id);
    loadTasks();
  };

  const refresh = async (t: Task) => {
    const auth = await authHeader();
    await fetch(`${FN_BASE}/odm-poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ task_id: t.id }),
    });
    loadTasks();
  };

  const statusTone = (s: string) =>
    s === "completed" ? "border-emerald-500 text-emerald-600" :
    s === "failed" ? "border-destructive text-destructive" :
    s === "processing" ? "border-sky-500 text-sky-600" :
    "border-amber-500 text-amber-600";

  if (!field) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading field...</div>;
  }

  const completed = tasks.filter(t => t.status === "completed").length;
  const active = tasks.filter(t => ACTIVE_STATUSES.includes(t.status)).length;

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link to="/app/fields" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> All fields
        </Link>
      </div>

      {/* Field header */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Leaf className="h-5 w-5 text-primary" />
              <FieldNameEditor
                name={field.name}
                onSave={async (newName) => {
                  const { error } = await supabase.from("fields").update({ name: newName }).eq("id", field.id);
                  if (error) { toast.error(error.message); return; }
                  setField({ ...field, name: newName });
                  toast.success("Field renamed");
                }}
              />
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {field.crop} · {field.area_hectares} ha{field.location ? ` · ${field.location}` : ""}
            </div>
            {field.notes && <div className="text-sm mt-2 max-w-2xl">{field.notes}</div>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5 text-sm">
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground">Total scans</div>
            <div className="font-display text-2xl">{tasks.length}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground">Processing</div>
            <div className="font-display text-2xl">{active}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground">Orthomosaics ready</div>
            <div className="font-display text-2xl">{completed}</div>
          </div>
        </div>
      </Card>

      {/* Step 2: upload */}
      <Card className="p-5 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Step 2</div>
          <h2 className="font-display text-xl">Upload drone images for this field</h2>
          <p className="text-sm text-muted-foreground">
            Drag a folder of overlapping drone images. We'll send them to OpenDroneMap, build an orthomosaic,
            and save the result as a scan tied to <strong>{field.name}</strong>.
          </p>
        </div>

        <div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/tiff"
            multiple
            onChange={e => setFiles(Array.from(e.target.files ?? []))}
            className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
          />
        </div>

        {files.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {files.length} image{files.length === 1 ? "" : "s"} selected · ~{(files.reduce((s, f) => s + f.size, 0) / 1_000_000).toFixed(1)} MB total
          </div>
        )}

        {/* An interrupted upload keeps its place. Say so plainly - on a metered
            connection, "you won't re-send those" is the reassurance that matters. */}
        {resumable && !busy && (
          <div className="flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/30 p-3 rounded">
            <RotateCcw className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
            <div className="space-y-1.5">
              <div>
                <strong>{resumable.done} of {resumable.total} images</strong> from an interrupted upload are already
                on the processing node. Select the same images and press Start — only the missing ones will be sent.
              </div>
              <button onClick={discardResume} className="underline text-muted-foreground hover:text-foreground">
                Discard saved progress and start fresh
              </button>
            </div>
          </div>
        )}

        {progress && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              {progress.phase === "uploading" && (
                <>Uploading {progress.done} / {progress.total} images
                  {progress.retrying && <> · retrying a slow image…</>}
                  {progress.failed > 0 && <> · {progress.failed} to retry</>}
                </>
              )}
              {progress.phase === "committing" && <>Starting reconstruction…</>}
              {progress.phase === "done" && <>Submitted.</>}
            </div>
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button onClick={submit} disabled={busy || !files.length || !user}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Uploading…" : resumable ? "Start / resume scan" : "Start scan & orthomosaic"}
          </Button>
          {busy && (
            <Button variant="outline" onClick={pauseUpload}>Pause</Button>
          )}
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 p-3 rounded border border-dashed">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            Recommended: overlapping nadir drone images at 70–80% overlap.
            Min {MIN_IMAGES}, max <strong>{maxImages}</strong> per scan
            {caps?.online
              ? " — read live from your processing node, so it matches what it will actually accept."
              : " (node unreachable; showing our default ceiling)."}
            {" "}Uploads resume where they stopped, so a dropped connection costs you nothing.
          </div>
        </div>
      </Card>

      {/* Scan history */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Scan history ({tasks.length})</div>
        </div>

        {tasks.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No scans yet for this field. Upload drone images above to start your first scan.
          </Card>
        )}

        {tasks.map(t => (
          <Card key={t.id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2">
                  <MapIcon className="h-4 w-4 text-primary" />
                  Scan · {t.image_count} image{t.image_count === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(t.created_at).toLocaleString()}
                  {t.odm_uuid && <> · ODM <span className="font-mono">{t.odm_uuid.slice(0, 8)}</span></>}
                </div>
              </div>
              <Badge variant="outline" className={statusTone(t.status)}>{t.status}</Badge>
            </div>

            {t.status === "failed" && (
              <div className="mt-2 text-xs text-destructive">
                {t.error ?? "This scan failed."}
                <div className="text-muted-foreground mt-1">
                  Retrying picks up from wherever it stopped — your uploaded images are still on the node.
                </div>
              </div>
            )}

            {ACTIVE_STATUSES.includes(t.status) && (
              <div className="mt-3 space-y-1">
                <Progress value={Math.max(2, Math.min(100, t.progress))} />
                <div className="text-xs text-muted-foreground">
                  {t.status === "uploading" && "Waiting for images…"}
                  {t.status === "queued" && "Queued on the processing node…"}
                  {t.status === "processing" && `Reconstructing · ${Math.round(t.progress)}%`}
                  {t.status === "mirroring" && "Saving results — nearly there…"}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-3 flex-wrap">
              {t.status === "completed" && (
                <>
                  {t.odm_uuid && (
                    <Button size="sm" asChild>
                      <a href={`/app/orthomosaic/${t.id}`} target="_blank" rel="noopener noreferrer">
                        <MapIcon className="h-3.5 w-3.5" /> View orthomosaic
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => downloadZip(t)}><Download className="h-3.5 w-3.5" /> Download</Button>
                </>
              )}
              {ACTIVE_STATUSES.includes(t.status) && t.status !== "uploading" && (
                <Button size="sm" variant="outline" onClick={() => refresh(t)}><RefreshCcw className="h-3.5 w-3.5" /> Check now</Button>
              )}
              {(t.status === "failed" || t.status === "mirroring") && (
                <Button size="sm" variant="outline" onClick={() => retryTask(t)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Retry
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => removeTask(t.id)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
            </div>

          </Card>
        ))}

        {tasksHasMore && (
          <div className="flex justify-center pt-1">
            <Button variant="outline" size="sm" onClick={() => loadTasks({ page: taskPage + 1 })}>
              Load older scans
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldNameEditor({ name, onSave }: { name: string; onSave: (n: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVal(name); }, [name]);
  if (!editing) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="font-display text-3xl truncate">{name}</h1>
        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 opacity-60 hover:opacity-100"
          onClick={() => setEditing(true)} aria-label="Rename field">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }
  const commit = async () => {
    const v = val.trim();
    if (!v || v === name) { setEditing(false); setVal(name); return; }
    setBusy(true);
    try { await onSave(v); setEditing(false); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <input
        autoFocus value={val} disabled={busy}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setVal(name); } }}
        className="font-display text-3xl bg-transparent border-b border-primary outline-none min-w-0 flex-1"
      />
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={commit} disabled={busy} aria-label="Save">
        <Check className="h-4 w-4 text-emerald-500" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(false); setVal(name); }} disabled={busy} aria-label="Cancel">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}