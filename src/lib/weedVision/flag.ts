// Weed Vision Research Preview: the one switch.
//
// TEMPORARY RESEARCH INTEGRATION (branch experiment/weed-vision-preview).
// The page, its route, its sidebar entry and the dev-server proxy exist only
// when BOTH hold: the bundle is a Vite development build (import.meta.env.DEV)
// and VITE_WEED_VISION_PREVIEW=true is set in .env. A production build can
// never include it, whatever the variable says. Removal: delete src/lib/
// weedVision, src/components/app/weedVision, src/pages/app/WeedVisionPreview.tsx,
// and the six marked lines in App.tsx, AppLayout.tsx, vite.config.ts,
// vite-env.d.ts, PhotoViewer.tsx and .env.example (see
// research/weed-vision-lab/docs/research-preview.md).

export function isWeedVisionPreviewEnabled(env: { DEV?: boolean; VITE_WEED_VISION_PREVIEW?: string } = import.meta.env as unknown as { DEV?: boolean; VITE_WEED_VISION_PREVIEW?: string }): boolean {
  return env.DEV === true && env.VITE_WEED_VISION_PREVIEW === "true";
}

/** The dev-server path the Vite proxy forwards to the local Python service (127.0.0.1:8765). */
export const WEED_VISION_API_BASE = "/weed-vision-api";
