import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Map as MapIcon, Loader2, AlertCircle, Download, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { prepareForODM, hasGPS } from "@/lib/imagePrep";

type Task = {
  id: string;
  field_id: string | null;
  odm_uuid: string | null;
  status: string;
  progress: number;
  image_count: number;
  output_path: string | null;
  error: string | null;
  created_at: string;
};
type Field = { id: string; name: string };

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? `Bearer ${data.session.access_token}` : "";
}

async function uploadOne(odm_uuid: string, file: File): Promise<void> {
  const send = async () => {
    const fd = new FormData();
    fd.append("images", file, file.name);
    const upRes = await fetch(`${FN_BASE}/odm-submit`, {
      method: "POST",
      headers: { Authorization: await authHeader(), "x-action": "upload", "x-odm-uuid": odm_uuid },
      body: fd,
    });
    if (!upRes.ok) {
      const j = await upRes.json().catch(() => ({}));
      throw new Error(j.error ?? "Upload failed");
    }
  };
  try { await send(); } catch { await send(); }
}

export default function Models3D() {
  const { user } = useAuth();
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldId, setFieldId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadFields = async () => {
    const { data } = await supabase.from("fields").select("id, name").order("created_at", { ascending: false });
    setFields((data as Field[]) ?? []);
  };
  const loadTasks = async () => {
    const { data } = await supabase.from("odm_tasks").select("*").order("created_at", { ascending: false });
    setTasks((data as Task[]) ?? []);
  };
  useEffect(() => { loadFields(); loadTasks(); }, []);

  // Poll active tasks every 10s
  useEffect(() => {
    const active = tasks.filter(t => ["queued", "processing", "uploading"].includes(t.status));
    if (active.length === 0) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      const auth = await authHeader();
      await Promise.all(active.map(async (t) => {
        if (t.status === "uploading") return; // upload polling not needed
        await fetch(`${FN_BASE}/odm-poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({ task_id: t.id }),
        }).catch(() => {});
      }));
      loadTasks();
    }, 10000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [tasks]);

  const submit = async () => {
    if (!files.length) return toast.error("Select drone images first");
    if (files.length < 5) return toast.error("Need at least 5 images for reconstruction");
    if (files.length > 500) return toast.error("Max 500 images per task on our processing node");

    // Pre-flight GPS EXIF check — ungeoreferenced orthos render at (0,0) in the Atlantic.
    const sample = files.slice(0, Math.min(5, files.length));
    const gpsResults = await Promise.all(sample.map(hasGPS));
    const withGPS = gpsResults.filter(Boolean).length;
    if (withGPS === 0) {
      const proceed = window.confirm(
        "None of the sampled images have GPS EXIF tags.\n\n" +
        "Without GPS, the orthomosaic will NOT be georeferenced and will not display on the map. " +
        "Re-export your drone photos with GPS metadata intact.\n\n" +
        "Upload anyway?"
      );
      if (!proceed) return;
    } else if (withGPS < sample.length) {
      toast.warning(`Only ${withGPS}/${sample.length} sampled images have GPS — accuracy may suffer.`);
    }

    setBusy(true);
    setUploadProgress({ done: 0, total: files.length });
    let auth = await authHeader();

    try {
      // 1. INIT
      const initRes = await fetch(`${FN_BASE}/odm-submit`, {
        method: "POST",
        headers: {
          Authorization: auth,
          "x-action": "init",
          "x-field-id": fieldId || "",
          "x-image-count": String(files.length),
        },
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error ?? "Init failed");
      const { odm_uuid } = initJson;
      await loadTasks();

      // 2. UPLOAD each image sequentially. Prepare one file at a time so large batches don't exhaust browser memory.
      for (let i = 0; i < files.length; i++) {
        const prepared = await prepareForODM(files[i]);
        await uploadOne(odm_uuid, prepared);
        setUploadProgress({ done: i + 1, total: files.length });
      }

      // 3. COMMIT
      await supabase.auth.refreshSession().catch(() => {});
      auth = await authHeader();
      const cRes = await fetch(`${FN_BASE}/odm-submit`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json", "x-action": "commit" },
        body: JSON.stringify({ odm_uuid }),
      });
      const cJson = await cRes.json();
      if (!cRes.ok) throw new Error(cJson.error ?? "Commit failed");

      toast.success("Submitted - processing on WebODM. This may take 10 min to several hours.");
      setFiles([]);
      setFieldId("");
      loadTasks();
    } catch (e: any) {
      toast.error(e?.message ?? "Submission failed");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  const openOrthomosaic = (t: Task) => {
    if (!t.odm_uuid) return toast.error("Orthomosaic is not available yet");
    window.open(`/app/orthomosaic/${t.id}`, "_blank", "noopener");
  };

  const downloadZip = async (t: Task) => {
    if (!t.output_path) return;
    const { data, error } = await supabase.storage.from("scans").createSignedUrl(t.output_path, 60 * 10);
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank");
  };

  const remove = async (id: string) => {
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

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl">Orthomosaic Outputs</h1>
        <p className="text-muted-foreground">
          Upload a batch of drone images. We send them to our WebODM processing node and build a tiled orthomosaic from your field.
          Real processing - times vary from ~10 minutes to several hours depending on image count and detail.
        </p>
      </header>

      {/* Upload card */}
      <Card className="p-5 space-y-4">
        <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Field (optional)</label>
            <Select value={fieldId} onValueChange={setFieldId}>
              <SelectTrigger><SelectValue placeholder="Link this orthomosaic to one of your fields" /></SelectTrigger>
              <SelectContent>
                {fields.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No saved fields - add one in the Fields page first.</div>}
                {fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground block">Images</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/tiff"
              multiple
              onChange={e => setFiles(Array.from(e.target.files ?? []))}
              className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
          </div>
        </div>

        {files.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {files.length} image{files.length === 1 ? "" : "s"} selected · ~{(files.reduce((s, f) => s + f.size, 0) / 1_000_000).toFixed(1)} MB total
          </div>
        )}

        {uploadProgress && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Uploading {uploadProgress.done} / {uploadProgress.total} images to processing node...</div>
            <Progress value={(uploadProgress.done / uploadProgress.total) * 100} />
          </div>
        )}

        <Button onClick={submit} disabled={busy || !files.length || !user}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "Submitting..." : "Start orthomosaic processing"}
        </Button>

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 p-3 rounded border border-dashed">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            Recommended: 30 to 300 overlapping nadir images at 70 to 80 percent overlap.
            Minimum 5, maximum 500 images per task (processing node limit).
          </div>
        </div>
      </Card>

      {/* Task list */}
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Your reconstructions ({tasks.length})</div>
        {tasks.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No orthomosaics yet. Upload a batch of drone images above to get started.
          </Card>
        )}
        {tasks.map(t => (
          <Card key={t.id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2">
                  <MapIcon className="h-4 w-4 text-primary" />
                  Orthomosaic from {t.image_count} image{t.image_count === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Created {new Date(t.created_at).toLocaleString()}
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
                  {t.status === "uploading" ? "Uploading images..." : `Processing on WebODM · ${Math.round(t.progress)}%`}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-3 flex-wrap">
              {t.status === "completed" && (
                <>
                  <Button size="sm" onClick={() => openOrthomosaic(t)}><MapIcon className="h-3.5 w-3.5" /> View</Button>
                  <Button size="sm" variant="outline" onClick={() => downloadZip(t)}><Download className="h-3.5 w-3.5" /> Download archive</Button>
                </>
              )}
              {["queued", "processing"].includes(t.status) && (
                <Button size="sm" variant="outline" onClick={() => refresh(t)}><RefreshCcw className="h-3.5 w-3.5" /> Check now</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}