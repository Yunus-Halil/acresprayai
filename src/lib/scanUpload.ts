// Fault-tolerant drone-image upload.
//
// The previous implementation was all-or-nothing: two concurrent uploads, one
// retry per image, failures collected and then thrown at the very end. On a
// flaky connection an image failing at #140 of 200 destroyed the whole batch,
// left the scan row stuck in 'uploading' forever, and cost the farmer the data
// allowance for the 140 images that did land. On a metered rural connection
// that is the difference between using this product and not.
//
// This module keeps per-image state, retries each image independently with
// backoff, and checkpoints progress so an interrupted batch resumes where it
// stopped rather than starting over.
import { supabase } from "@/integrations/supabase/client";
import { prepareForODM } from "@/lib/imagePrep";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

export const MIN_IMAGES = 5;
export const MAX_IMAGES = 200;
const CONCURRENCY = 2;
const PER_IMAGE_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 800;

/** Checkpoint written after every image so a reload can resume. */
type Checkpoint = {
  odmUuid: string;
  taskId: string;
  fieldId: string;
  /** File identity (name+size+mtime) of every image ODM has accepted. */
  done: string[];
  total: number;
  savedAt: number;
};

const ckptKey = (fieldId: string) => `acrespray.upload.${fieldId}`;
/** Files have no stable id across page loads; name+size+mtime is close enough. */
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function readCheckpoint(fieldId: string): Checkpoint | null {
  try {
    const raw = localStorage.getItem(ckptKey(fieldId));
    if (!raw) return null;
    const c = JSON.parse(raw) as Checkpoint;
    // A checkpoint older than a day is more likely to confuse than help.
    if (!c?.odmUuid || Date.now() - c.savedAt > 86_400_000) return null;
    return c;
  } catch { return null; }
}
export function clearCheckpoint(fieldId: string) {
  try { localStorage.removeItem(ckptKey(fieldId)); } catch { /* private mode */ }
}
function writeCheckpoint(c: Checkpoint) {
  try { localStorage.setItem(ckptKey(c.fieldId), JSON.stringify(c)); } catch { /* quota / private mode */ }
}

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? `Bearer ${data.session.access_token}` : "";
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type UploadPhase = "preparing" | "uploading" | "committing" | "done";
export type UploadProgress = {
  phase: UploadPhase;
  done: number;
  total: number;
  /** Images that exhausted their retries. The batch continues around them. */
  failed: number;
  /** Set while waiting out a backoff, so the UI can say so instead of looking hung. */
  retrying?: boolean;
};

export class UploadError extends Error {
  constructor(message: string, readonly resumable: boolean) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Upload one image, retrying transient failures with exponential backoff.
 * The auth token is re-fetched per attempt because a long batch outlives a JWT.
 */
async function uploadOne(
  odmUuid: string,
  file: File,
  onRetry: () => void,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PER_IMAGE_ATTEMPTS; attempt++) {
    try {
      const fd = new FormData();
      fd.append("images", file, file.name);
      const res = await fetch(`${FN_BASE}/odm-submit`, {
        method: "POST",
        headers: { Authorization: await authHeader(), "x-action": "upload", "x-odm-uuid": odmUuid },
        body: fd,
      });
      if (res.ok) return;

      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      const msg = typeof j?.error === "string" ? j.error : `HTTP ${res.status}`;

      // The node rejecting the batch size will reject it every time. Abort the
      // whole run rather than burning the farmer's data on 199 more attempts.
      if (j?.code === "max_images" || res.status === 413) {
        throw new UploadError(
          "The processing node rejected this batch: too many images. Split the scan into smaller batches.",
          false,
        );
      }
      // 4xx other than rate limiting is a real rejection of this image.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new UploadError(`${file.name}: ${msg}`, true);
      }
      lastErr = new Error(`${file.name}: ${msg}`);
    } catch (e) {
      if (e instanceof UploadError && !e.resumable) throw e;
      lastErr = e;
    }
    if (attempt < PER_IMAGE_ATTEMPTS) {
      onRetry();
      await sleep(Math.random() * BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  throw lastErr ?? new Error(`${file.name}: upload failed`);
}

/**
 * Run a full scan upload: init (or resume), upload every image, then commit.
 *
 * Individual images that exhaust their retries do NOT kill the run — they are
 * reported back so the caller can offer a targeted retry of just those. The
 * scan is only committed when every image is in.
 */
export async function uploadScan(opts: {
  fieldId: string;
  files: File[];
  onProgress: (p: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<{ taskId: string; odmUuid: string }> {
  const { fieldId, files, onProgress, signal } = opts;

  // Start from a fresh, long-lived token: a 200-image batch easily outlives one.
  await supabase.auth.refreshSession().catch(() => {});

  // ---- Resume or init ----------------------------------------------------
  const prior = readCheckpoint(fieldId);
  const resumable = prior && prior.total === files.length;
  let odmUuid: string;
  let taskId: string;
  const alreadyDone = new Set<string>(resumable ? prior!.done : []);

  if (resumable) {
    odmUuid = prior!.odmUuid;
    taskId = prior!.taskId;
  } else {
    clearCheckpoint(fieldId);
    const initRes = await fetch(`${FN_BASE}/odm-submit`, {
      method: "POST",
      headers: {
        Authorization: await authHeader(),
        "x-action": "init",
        "x-field-id": fieldId,
        "x-image-count": String(files.length),
      },
    });
    const initJson = await initRes.json().catch(() => ({}));
    if (!initRes.ok) throw new UploadError(initJson?.error ?? "Could not start the scan", false);
    odmUuid = initJson.odm_uuid;
    taskId = initJson.task_id;
  }

  const checkpoint: Checkpoint = {
    odmUuid, taskId, fieldId, total: files.length,
    done: [...alreadyDone], savedAt: Date.now(),
  };
  writeCheckpoint(checkpoint);

  // ---- Upload ------------------------------------------------------------
  const pending = files.filter(f => !alreadyDone.has(fileKey(f)));
  let done = alreadyDone.size;
  const failures: { file: File; message: string }[] = [];
  let aborted: UploadError | null = null;
  let cursor = 0;

  onProgress({ phase: "uploading", done, total: files.length, failed: 0 });

  const worker = async () => {
    while (!aborted) {
      if (signal?.aborted) return;
      const i = cursor++;
      if (i >= pending.length) return;
      const file = pending[i];
      try {
        const prepared = await prepareForODM(file);
        await uploadOne(odmUuid, prepared, () => {
          onProgress({ phase: "uploading", done, total: files.length, failed: failures.length, retrying: true });
        });
        alreadyDone.add(fileKey(file));
        done++;
        // Checkpoint every image. An interrupted batch resumes from here.
        checkpoint.done = [...alreadyDone];
        checkpoint.savedAt = Date.now();
        writeCheckpoint(checkpoint);
      } catch (e) {
        if (e instanceof UploadError && !e.resumable) { aborted = e; return; }
        failures.push({ file, message: (e as Error)?.message ?? String(e) });
      }
      onProgress({ phase: "uploading", done, total: files.length, failed: failures.length });
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (aborted) { clearCheckpoint(fieldId); throw aborted; }
  if (signal?.aborted) {
    throw new UploadError("Upload paused. Your progress is saved — start it again to resume.", true);
  }
  if (failures.length) {
    // Progress is checkpointed, so retrying re-sends only what is missing.
    throw new UploadError(
      `${failures.length} of ${files.length} images could not be uploaded. ` +
      `Your progress is saved — retry to send just the missing ones. First error: ${failures[0].message}`,
      true,
    );
  }

  // ---- Commit ------------------------------------------------------------
  onProgress({ phase: "committing", done, total: files.length, failed: 0 });
  await supabase.auth.refreshSession().catch(() => {});
  const cRes = await fetch(`${FN_BASE}/odm-submit`, {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json", "x-action": "commit" },
    body: JSON.stringify({ odm_uuid: odmUuid }),
  });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok) {
    throw new UploadError(
      cJson?.error ?? "The processing node would not start this scan. Your images are uploaded — retry to start it.",
      true,
    );
  }

  clearCheckpoint(fieldId);
  onProgress({ phase: "done", done, total: files.length, failed: 0 });
  return { taskId, odmUuid };
}
