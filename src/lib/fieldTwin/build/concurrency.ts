// How much of the build runs at once on this device: the helper workers (the soil ties, the colour pass, the crops) and
// the corn reads among them. Sized by memory first, then by cores. The results do not depend on it: the ties are put
// back in pair order and the corn reads in name order whatever finishes first (cameras.ts, corn.ts).
//
// What it costs, measured on the 123-photograph corn flight (docs/research/photo-ground-founder-stage-2026-11-15.md):
//  - a corn read holds a full-size photograph decoded (5280 x 3956: 84 MB as pixels, more while the canvas and the
//    bitmap are alive) and its masks, so each read at once adds about 0.2-0.5 GB at the peak;
//  - a helper holds the grey rasters of the photographs whose ties it computes (about 1.6 MB each, up to the whole
//    flight on a flight with high overlap) until the cameras are aligned;
//  - 3 helpers took the same time as 6 on a 12-core laptop, because the corn reads (3 at once) dominate.
// A tablet's browser (iPadOS Safari) runs the page and every worker in one process and stops it when it uses too much
// memory, at a limit Apple does not publish: there the build is kept small.

export type DeviceHints = {
  /** navigator.hardwareConcurrency, when the browser says. */
  cores: number | null;
  /** navigator.deviceMemory (Chrome and Edge; at most 8, rounded), when the browser says. */
  memoryGB: number | null;
  /** A tablet or a phone (iPadOS Safari calls itself a Mac: a Mac has no touch screen). */
  mobile: boolean;
};

export type BuildConcurrency = { helpers: number; cornParallel: number; reason: string };

export const CONCURRENCY = {
  /** Never more helpers than this, whatever the cores. */
  maxHelpers: 6,
  /** Corn reads at once with memory to spare (a desktop, or a browser that does not say). */
  cornParallel: 3,
  /** A tablet or a phone. */
  mobile: { helpers: 3, cornParallel: 2 },
  /** A browser that says it has 4 GB or less. */
  memory4: { helpers: 3, cornParallel: 2 },
  /** A browser that says it has 2 GB or less. */
  memory2: { helpers: 2, cornParallel: 1 },
} as const;

/** The plan for this device. `asked` (a benchmark's ?helpers=) overrides the helpers; the corn reads never exceed them. */
export function buildConcurrency(d: DeviceHints, asked: { helpers?: number } = {}): BuildConcurrency {
  const byCores = Math.max(1, Math.min(CONCURRENCY.maxHelpers, (d.cores && d.cores > 0 ? d.cores : 2) - 1));
  let helpers: number, corn: number, reason: string;
  if (d.mobile) { helpers = Math.min(byCores, CONCURRENCY.mobile.helpers); corn = CONCURRENCY.mobile.cornParallel; reason = "a tablet or phone: kept small for its browser's memory"; }
  else if (d.memoryGB != null && d.memoryGB <= 2) { helpers = Math.min(byCores, CONCURRENCY.memory2.helpers); corn = CONCURRENCY.memory2.cornParallel; reason = `${d.memoryGB} GB of memory`; }
  else if (d.memoryGB != null && d.memoryGB <= 4) { helpers = Math.min(byCores, CONCURRENCY.memory4.helpers); corn = CONCURRENCY.memory4.cornParallel; reason = `${d.memoryGB} GB of memory`; }
  else { helpers = byCores; corn = CONCURRENCY.cornParallel; reason = d.memoryGB != null ? `${d.memoryGB} GB of memory or more, ${d.cores ?? "?"} cores` : `${d.cores ?? "?"} cores`; }
  if (asked.helpers && asked.helpers > 0) { helpers = Math.floor(asked.helpers); reason = `${helpers} helpers asked for`; }
  return { helpers, cornParallel: Math.max(1, Math.min(corn, helpers)), reason };
}

type Nav = { hardwareConcurrency?: number; deviceMemory?: number; userAgent?: string; maxTouchPoints?: number };

/** What this browser says about itself (the page or a worker; a worker cannot see touch points, so the page sends its own). */
export function deviceHints(nav: Nav | undefined = typeof navigator !== "undefined" ? (navigator as Nav) : undefined): DeviceHints {
  if (!nav) return { cores: null, memoryGB: null, mobile: false };
  const ua = nav.userAgent ?? "";
  const mobile = /iPad|iPhone|iPod|Android|Mobile/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  return { cores: nav.hardwareConcurrency ?? null, memoryGB: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null, mobile };
}
