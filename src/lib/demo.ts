import type { SprayZone } from "@/components/app/Field3D";

export const DEMO_FIELDS = [
  {
    id: "demo-b04", name: "B-04 · North Quadrant", crop: "Wheat", area_hectares: 14.2,
    location: "47.2184° N, 2.0411° E · Cher, FR", health: 78,
    notes: "Aphid pressure detected eastern centre. Spray queued.",
    zones: [
      { x: 5, z: -2, w: 3.5, d: 3, severity: "high", label: "Aphids · 0.42 ha" },
      { x: -6, z: 3, w: 5, d: 3.5, severity: "medium", label: "Septoria · 1.1 ha" },
      { x: 7, z: 5, w: 2.5, d: 2, severity: "low", label: "We
