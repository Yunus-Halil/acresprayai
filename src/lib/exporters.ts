// The export registry: one descriptor per output format, all fed from the same
// canonical mission model.
//
// WHY A REGISTRY. Whether a format reaches a grower is a property of the format,
// not of the button that happens to render it. Parking the WPML exporter should
// be one field changing from "shipping" to "experimental" — not a deleted button
// in a 1400-line component, where the next person cannot tell whether it was a
// decision or an accident. The UI renders `userFacingExporters()` and knows
// nothing else about which formats exist.
//
// WHAT THE AIRCRAFT ACTUALLY WANT — this is the reason the list looks like it
// does. Enterprise DJI aircraft (M30/M300/M350/Mavic 3E) fly a ROUTE you hand
// them, as WPML. Agras does not work that way: you hand it a FIELD — a boundary
// polygon plus an optional prescription map — and the controller plans its own
// flight lines on the aircraft. That is why DJI's published WPML spec contains
// no spray vocabulary at all, and why the Agras package is the shipping path
// while the route exporter is parked.
//
// Our flight lines were therefore never the deliverable. They are how we
// simulate — path length, spray vs transit time, battery draw, swaps needed —
// which is the part a grower cannot get from DJI's own planner without standing
// in the field. What has to travel to the aircraft is the treatment plan.
import type { LatLng2 } from "./geo";
import { type Mission, exportMissionFile } from "./mission";
import { AGRAS_IMPORT_STEPS, RX_RATE_UNIT, type RateZone, buildAgrasPackage } from "./djiAgras";
import { buildWpmlKmz } from "./wpml";

export type ExporterStatus =
  /** Registered, offered to growers, verified as far as we can verify it. */
  | "shipping"
  /** Kept and tested, deliberately NOT offered. See the exporter's `caveat`. */
  | "experimental";

export type ExportContext = {
  taskId: string;
  mission: Mission | null;
  boundary: LatLng2[][] | null;
  zones: RateZone[];
  transitSpeed: number;
  spraySpeed: number;
  transitAltM: number;
};

export type ExportResult = {
  blob: Blob;
  filename: string;
  /** Short summary for the success toast. */
  detail: string;
};

export type Exporter = {
  id: string;
  label: string;
  /** One line under the button. */
  description: string;
  status: ExporterStatus;
  /** Why this is parked. Required for anything not shipping. */
  caveat?: string;
  /** Null when it can run; otherwise the reason, shown to the user. */
  blockedReason(ctx: ExportContext): string | null;
  build(ctx: ExportContext): ExportResult;
};

const hasMission = (ctx: ExportContext) =>
  ctx.mission && ctx.mission.waypoints.length > 0 ? null : "Generate a mission first";

export const EXPORTERS: Exporter[] = [
  {
    // The primary path. An Agras is handed a field, not a route.
    id: "agras-rx",
    label: "DJI Agras field + prescription",
    description:
      `Boundary shapefile and a variable-rate map in ${RX_RATE_UNIT}. ` +
      "The aircraft plans its own flight lines from these.",
    status: "shipping",
    blockedReason(ctx) {
      if (!ctx.boundary?.length) return "Draw a field boundary first";
      if (!ctx.zones.length) return "No treatment zones to prescribe";
      if (!ctx.zones.some(z => z.rateLha > 0)) return "Set an application rate above zero";
      return null;
    },
    build(ctx) {
      const pkg = buildAgrasPackage({ boundary: ctx.boundary!, zones: ctx.zones });
      const v = pkg.verification;
      return {
        blob: pkg.zip,
        filename: `dji-agras-${ctx.taskId}.zip`,
        detail:
          `${pkg.raster.width}×${pkg.raster.height} px at ${pkg.raster.resolutionM.toFixed(2)} m/px · ` +
          `${v.rateRange.min}–${v.rateRange.max} ${RX_RATE_UNIT} · ` +
          `import with Map Source “${AGRAS_IMPORT_STEPS.mapSource}”, ` +
          `Source Unit “${AGRAS_IMPORT_STEPS.sourceUnit}”`,
      };
    },
  },
  {
    id: "waypoints",
    label: "Mission Planner route",
    description: "QGC WPL 110 waypoints. For ground-station software, not for Agras.",
    status: "shipping",
    blockedReason: hasMission,
    build(ctx) {
      return {
        blob: exportMissionFile(ctx.mission!),
        filename: `mission-${ctx.taskId}.waypoints`,
        detail: `${ctx.mission!.waypoints.length} waypoints, QGC WPL 110`,
      };
    },
  },
  {
    id: "wpml-kmz",
    label: "DJI WPML route (.kmz)",
    description: "Waypoint route in DJI's WPML dialect.",
    status: "experimental",
    caveat:
      "No confirmed path onto a consumer aircraft. DJI Fly ships no route-import function, " +
      "and the known workarounds sideload into the app's private storage, which Android 11+ " +
      "blocks. The file matches DJI's published spec; the delivery method does not exist. " +
      "Agras cannot use it either — it wants a field, not a route.",
    blockedReason: hasMission,
    build(ctx) {
      const pkg = buildWpmlKmz(ctx.mission!, {
        author: "SwathWise",
        createTimeMs: Date.now(),
        // Derived from the planned mission, not hardcoded placeholders.
        transitSpeed: ctx.transitSpeed,
        autoFlightSpeed: ctx.spraySpeed,
        takeOffSecurityHeightM: ctx.transitAltM,
        finishAction: "goHome",
        exitOnRCLost: "executeLostAction",
        executeRCLostAction: "goBack",
      });
      return {
        blob: pkg.kmz,
        filename: `mission-${ctx.taskId}.kmz`,
        detail: `${pkg.waypointCount} waypoints · wpmz/template.kml + waylines.wpml`,
      };
    },
  },
];

/** The formats a grower is actually offered. */
export function userFacingExporters(): Exporter[] {
  return EXPORTERS.filter(e => e.status === "shipping");
}

export function exporterById(id: string): Exporter | undefined {
  return EXPORTERS.find(e => e.id === id);
}
