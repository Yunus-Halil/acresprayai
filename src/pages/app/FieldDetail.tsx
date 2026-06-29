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
  ArrowLeft, Leaf, Pencil, Check, X,
} from "lucide-react";
import { toast } from "sonner";
import { prepareForODM, hasGPS } from "@/lib/imagePrep";

type Task = {
  id: string; field_id: string; odm_uuid: string | null;
  status: string; progress: number; image_count: number;
  output_path: string | null; error: string | null; created_at: string;
};
type Field = {
  id: string; name: string; crop: string; area_hectares: number;
  location: string | null; notes: string | null; created_at: string;
};

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const UPLOAD_CONCURRENCY = 2;

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
  const [phase, setPhase] = useState<"idle" | "downscaling" | "uploading" | "committing">("idle");
  const [phaseProgress, setPhaseProgress] = useState<{ done: number; total: number } | null>(null);
  const [orthoAvailable, setOrthoAvailable] = useState<Record<string, boolean>>({});
  const pollRef = useRef<number | null>(null);

  const loadField = async () => {
    if (!fieldId) return;
    const { data, error } = await supabase.from("fields").select("*").eq("id", fieldId).maybeSingle();
    if (error || !data) { toast.error("Field not found"); navigate("/app/fields"); return; }
    setField(data as Field);
  };
  const loadTasks = async () => {
    if (!fieldId) return;
    const { data } = await supabase.from("odm_tasks").select("*")
      .eq("field_id", fieldId).order("created_at", { ascending: false });
    setTasks((data as Task[]) ?? []);
  };
  useEffect(() => { loadField(); loadTasks(); }, [fieldId]);

  // Poll active tasks every 10s
  useEffect(() => {
    const active = tasks.filter(t => ["queued", "processing"].includes(t.status));
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
      loadTasks();
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

  async function uploadOne(odm_uuid: string, file: File): Promise<void> {
    const send = async () => {
      // Always fetch a fresh token per request - supabase auto-refreshes when near expiry.
      // This prevents "Invalid Compact JWS" failures partway through long batch uploads.
      const auth = await authHeader();
      const fd = new FormData();
      fd.append("images", file, file.name);
      const r = await fetch(`${FN_BASE}/odm-submit`, {
        method: "POST",
        headers: { Authorization: auth, "x-action": "upload", "x-odm-uuid": odm_uuid },
        body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        const err: any = new Error(j?.error ? `${file.name}: ${j.error}` : `${file.name}: ${r.status}`);
        err.code = j?.code;
        err.status = r.status;
        throw err;
      }
    };
    try { await send(); }
    catch (e: any) {
      // Don't retry hard failures from the node (e.g. max images exceeded) - it'll just fail again.
      if (e?.code === "max_images" || e?.status === 413) throw e;
      await send();
    }
  }

  const submit = async () => {
    if (!fieldId) return;
    if (!files.length) return toast.error("Select drone images first");
    if (files.length < 5) return toast.error("Need at least 5 images for reconstruction");
    if (files.length > 200) return toast.error("Max 200 images per scan (processing node limit)");

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
    try {
      // Proactively refresh so we start with a fresh ~1h token.
      await supabase.auth.refreshSession().catch(() => {});
      let auth = await authHeader();

      // Phase 1: init task on ODM. Do not pre-load all images into memory.
      const initRes = await fetch(`${FN_BASE}/odm-submit`, {
        method: "POST",
        headers: {
          Authorization: auth,
          "x-action": "init",
          "x-field-id": fieldId,
          "x-image-count": String(files.length),
        },
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error ?? "Init failed");
      const { odm_uuid } = initJson;
      await loadTasks();

      // Phase 2: upload in tiny batches. Each image is prepared just-in-time and released after upload.
      setPhase("uploading");
      let done = 0;
      setPhaseProgress({ done: 0, total: files.length });
      let cursor = 0;
      const total = files.length;
      const errors: string[] = [];
      let aborted: Error | null = null;
      const worker = async () => {
        while (!aborted) {
          const i = cursor++;
          if (i >= total) return;
          try {
            const prepared = await prepareForODM(files[i]);
            await uploadOne(odm_uuid, prepared);
          } catch (e: any) {
            if (e?.code === "max_images") {
              aborted = new Error(
                "Your processing node rejected the batch: max images per task exceeded. " +
                "Split the scan into smaller batches and try again."
              );
              return;
            }
            errors.push(e?.message ?? String(e));
          }
          done++;
          setPhaseProgress({ done, total });
        }
      };
      await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
      if (aborted) throw aborted;
      if (errors.length) throw new Error(`${errors.length} image upload(s) failed. First: ${errors[0]}`);

      // Phase 3: commit
      setPhase("committing");
      // Token may have expired during a long upload - refresh before the final call.
      await supabase.auth.refreshSession().catch(() => {});
      auth = await authHeader();
      const cRes = await fetch(`${FN_BASE}/odm-submit`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json", "x-action": "commit" },
        body: JSON.stringify({ odm_uuid }),
      });
      const cJson = await cRes.json();
      if (!cRes.ok) throw new Error(cJson.error ?? "Commit failed");

      toast.success("Scan submitted - processing on OpenDroneMap. This may take 10 min to several hours.");
      setFiles([]);
      loadTasks();
    } catch (e: any) {
      toast.error(e?.message ?? "Submission failed");
    } finally {
      setBusy(false);
      setPhase("idle");
      setPhaseProgress(null);
    }
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
  const active = tasks.filter(t => ["queued", "processing"].includes(t.status)).length;

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

        {phaseProgress && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              {phase === "downscaling" && <>Preparing images {phaseProgress.done} / {phaseProgress.total}…</>}
              {phase === "uploading" && <>Uploading {phaseProgress.done} / {phaseProgress.total} images to OpenDroneMap…</>}
              {phase === "committing" && <>Starting reconstruction…</>}
            </div>
            <Progress value={(phaseProgress.done / Math.max(1, phaseProgress.total)) * 100} />
          </div>
        )}

        <Button onClick={submit} disabled={busy || !files.length || !user}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "Submitting..." : "Start scan & orthomosaic"}
        </Button>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 p-3 rounded border border-dashed">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            Recommended: 30–200 overlapping nadir drone images at 70–80% overlap. Min 5, max 200 per scan (processing-node limit).
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

            {t.status === "failed" && t.error && (
              <div className="text-xs text-destructive mt-2">{t.error}</div>
            )}

            {["queued", "processing", "uploading"].includes(t.status) && (
              <div className="mt-3 space-y-1">
                <Progress value={Math.max(2, Math.min(100, t.progress))} />
                <div className="text-xs text-muted-foreground">
                  {t.status === "uploading" ? "Uploading images..." : `Processing on OpenDroneMap · ${Math.round(t.progress)}%`}
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
              {["queued", "processing"].includes(t.status) && (
                <Button size="sm" variant="outline" onClick={() => refresh(t)}><RefreshCcw className="h-3.5 w-3.5" /> Check now</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => removeTask(t.id)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}