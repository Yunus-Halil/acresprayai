// The app's view of a scan's source material: lib/sourceFrames/sources.ts
// bound to the browser's Supabase client. Everything that reads the archive
// or the frame list is in sources.ts, so the developer benchmark runs the
// same code against the same storage with its own credentials.
import { supabase } from "@/integrations/supabase/client";
import type { FrameManifestEntry } from "./manifest";
import { type ScanSources, downloadFrameWith, loadScanSourcesWith } from "./sources";

export type { OdmStats, ScanSources } from "./sources";

export function loadScanSources(input: { userId: string; odmUuid: string; outputPath: string | null }): Promise<ScanSources> {
  return loadScanSourcesWith(supabase, input);
}

/** The original bytes of one kept frame. */
export function downloadFrame(entry: FrameManifestEntry): Promise<Blob | null> {
  return downloadFrameWith(supabase, entry);
}
