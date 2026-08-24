// Row shapes the workspace loads. Extracted from OrthomosaicViewer.tsx.
import type { FarmerSettings } from "@/lib/farmerSettings";

export type TaskRow = {
  odm_uuid: string | null;
  field_id: string;
  created_at: string;
  /** Saved analysis JSON, incl. the last_run success/failure marker. */
  ai_analysis?: unknown;
  ai_analysis_at?: string | null;
};
export type BoundaryRing = { lat: number; lng: number }[];
export type FieldRow = {
  id: string;
  name: string;
  boundary: BoundaryRing[] | BoundaryRing | null;
  boundary_area_hectares: number | null;
  settings?: FarmerSettings | null;
};

// Field configuration, drone capability data, geometry and mission building now
// live in `src/lib/*` so they can be unit-tested and imported without pulling in
// this component. Re-exported from here for modules that still import them by
