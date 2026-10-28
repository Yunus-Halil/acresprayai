// Building a Field Twin inside the app: the contracts the pipeline stages share.
//
// The pipeline (pipeline.ts) is the milestone scripts of scripts/directGeoref/ (run, exp1Align, m2Rows, m1Weeds,
// buildTwin, boundaryEvidence, boundary) turned into pure stages that take photographs through two small
// abstractions, so the same code runs in a browser worker (browserPhotos.ts: createImageBitmap, OffscreenCanvas)
// and in Node (scripts/directGeoref/nodePhotos.ts: jpeg-js) for the scripts and the tests.
import type { PhotoPixels } from "../../photoScout/pattern";
import type { WeedVisionResult } from "../../weedVision/client";

/** One original photograph, read on demand. Nothing is held decoded between calls unless the source caches it. */
export type PhotoSource = {
  /** The file's base name without its extension (DJI_0301). */
  name: string;
  /** The first megabyte of the file, where the EXIF and XMP headers are. */
  header(): Promise<Uint8Array>;
  /** The whole file, for the weed model. */
  bytes(): Promise<Blob | Uint8Array>;
  /** The photograph decoded and box-averaged by `down` (1 = full size). */
  decode(down: number): Promise<PhotoPixels>;
  /** The preview the camera wrote into the file (the MPF index; DJI: 960 x 640), decoded; null when the file has none. */
  preview(): Promise<PhotoPixels | null>;
  /** Square windows of the ORIGINAL (x0, y0, size in original pixels), each resampled to `out` x `out` RGBA pixels (box-averaged when shrinking); one decode for all of them. */
  crops(reqs: { x0: number; y0: number; size: number; out: number }[]): Promise<Uint8ClampedArray[]>;
};

/** Encoding for the atlases. */
export type Codec = {
  encodeJpeg(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, quality: number): Promise<Blob | Uint8Array>;
};

/** The weed model, injected: the browser calls the local service through the dev proxy, a script may read saved answers; null skips the weeds. */
export type WeedDetector = ((photo: PhotoSource, signal?: AbortSignal) => Promise<WeedVisionResult | null>) | null;

export type BuildStage = "photographs" | "cameras" | "rows" | "weeds" | "vegetation" | "evidence" | "boundary" | "bundle";
export const BUILD_STAGES: { id: BuildStage; label: string }[] = [
  { id: "photographs", label: "Reading the photographs" },
  { id: "cameras", label: "Aligning the cameras on the soil" },
  { id: "rows", label: "Rows and trees in every photograph" },
  { id: "weeds", label: "Weeds in every photograph" },
  { id: "vegetation", label: "Other vegetation" },
  { id: "evidence", label: "What the photographs show at the edges" },
  { id: "boundary", label: "The cultivated block" },
  { id: "bundle", label: "The twin and its evidence crops" },
];

export type BuildProgress = { stage: BuildStage; done: number; total: number | null; message: string; elapsedMs: number };

export type BuildHooks = {
  onProgress?: (p: BuildProgress) => void;
  log?: (line: string) => void;
  signal?: AbortSignal;
};

export type BuildOptions = {
  /** The twin's name as the operator typed it; the id is derived from it and the capture date. */
  name: string;
  id?: string;
  /** Decode factor for the detectors and the soil ties (4: quarter size, about 4 cm pixels at 36 m). */
  down?: number;
  /** Evidence raster cell, metres. */
  evidenceCellM?: number;
  /** The weed model, or null to build without weeds. */
  detector: WeedDetector;
  /** Fewest photographs with ties for the per-photo attitude fit; under it only the four global numbers are fitted. */
  minTiePhotos?: number;
  /** Read the camera's embedded preview instead of decoding the frame (default true); false forces the `down` decode. */
  usePreview?: boolean;
  /** Share of photo pairs whose ties are held out of every fit and reported as `cameras.heldOutResidualM` (0 = none, the shipped twin). */
  holdOutShare?: number;
  /** The planting-layout fitter's raster cell, metres (default 0.08; rounded to whole decoded pixels). */
  rowRasterCellM?: number;
};

export class BuildCancelled extends Error { constructor() { super("cancelled"); } }

export const checkCancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new BuildCancelled(); };

/** An id for a twin from its name and capture date: lowercase letters, digits and dashes, as parseTwin demands. */
export function twinIdFrom(name: string, capturedAt: string | null): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "twin";
  const date = capturedAt ? capturedAt.slice(0, 10).replace(/[^0-9]/g, "-").replace(/-+$/g, "") : "";
  const id = date ? `${slug}-${date}` : slug;
  return /^[a-z0-9]/.test(id) ? id.slice(0, 64) : `t-${id}`.slice(0, 64);
}

/** The timing of each stage, for the report. */
export type StageTimings = Partial<Record<BuildStage, number>>;
