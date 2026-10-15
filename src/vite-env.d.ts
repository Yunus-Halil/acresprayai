/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The short commit the bundle was built from ("dev" when unknown); see vite.config.ts. */
declare const __BUILD_SHA__: string;
/** When the bundle was built, ISO 8601. */
declare const __BUILD_TIME__: string;

// WEED-VISION-PREVIEW (temporary research integration; remove with the branch)
interface ImportMetaEnv {
  /** "true" turns on the Weed Vision Research Preview in dev builds only. */
  readonly VITE_WEED_VISION_PREVIEW?: string;
}
