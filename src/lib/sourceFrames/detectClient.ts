// The browser's door onto the baseline detector: one image to the
// bench-detect edge function, which holds the key, and the normalised result
// back. Nothing about the detector's service, its address or its key is in
// this file or anywhere else in the app.
import { supabase } from "@/integrations/supabase/client";
import type { ModelResult } from "./benchTypes";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

/** The developer's own model id for the detector, per browser; empty means the server's default. */
const MODEL_KEY = "swathwise.detectorModel";
const MODEL_ID = /^[A-Za-z0-9._-]+\/\d+$/;

export function getDetectorModel(): string {
  try { return (localStorage.getItem(MODEL_KEY) ?? "").trim(); } catch { return ""; }
}
export function setDetectorModel(id: string): void {
  try { if (id.trim()) localStorage.setItem(MODEL_KEY, id.trim()); else localStorage.removeItem(MODEL_KEY); } catch { /* private mode */ }
}
export const isModelId = (id: string): boolean => MODEL_ID.test(id);

/** The settings the in-app run reports; the server decides the model unless the developer named one. */
export function baselineSettings(): Record<string, string | number> {
  return { provider: "bench-detect edge function", model: getDetectorModel() || "server default" };
}

const failed = (error: string): ModelResult => ({
  status: "API_ERROR", modelId: null, count: 0, maxConfidence: null, meanConfidence: null,
  detections: [], imageWidth: null, imageHeight: null, elapsedMs: null, error,
});

const toBase64 = (blob: Blob): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^;]+;base64,/, ""));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

/** Ask the baseline detector about one crop. Never throws. */
export async function detectWithBaseline(blob: Blob, mime: "image/jpeg" | "image/png", fetchImpl: typeof fetch = fetch): Promise<ModelResult> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return failed("not signed in");
    const res = await fetchImpl(`${FN_BASE}/bench-detect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image: await toBase64(blob), mime, ...(isModelId(getDetectorModel()) ? { model: getDetectorModel() } : {}) }),
    });
    const json = await res.json().catch(() => null) as ModelResult | null;
    if (json && typeof json.status === "string") return json;
    return failed(`HTTP ${res.status}`);
  } catch (e) {
    return failed((e as Error)?.message ?? String(e));
  }
}
