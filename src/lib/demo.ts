import type { SprayZone } from "@/components/app/Field3D";

export type DemoField = {
  id: string;
  name: string;
  crop: string;
  area_hectares: number;
  location: string;
  health: number;
  notes: string;
  zones: SprayZone[];
};

export const DEMO_FIELDS: DemoField[] = [
  {
    id: "demo-b04",
    name: "B-04 North Quadrant",
    crop: "Winter Wheat",
    area_hectares: 14.2,
    location: "47.2184N, 2.0411E - Cher, FR",
    health: 78,
    notes: "Aphid pressure in eastern centre. Spray queued for tomorrow 06:12.",
    zones: [
      { x: 5, z: -2, w: 3.5, d: 3, severity: "high", label: "Aphids 0.42 ha" },
      { x: -6, z: 3, w: 5, d: 3.5, severity: "medium", label: "Septoria 1.1 ha" },
      { x: 7, z: 5, w: 2.5, d: 2, severity: "low", label: "Weeds 0.18 ha" },
    ],
  },
  {
    id: "demo-a02",
    name: "A-02 River Bend",
    crop: "Maize",
    area_hectares: 8.6,
    location: "47.2210N, 2.0388E - Cher, FR",
    health: 91,
    notes: "Healthy. Routine NDVI scan completed.",
    zones: [
      { x: -4, z: -3, w: 2, d: 2, severity: "low", label: "N deficit 0.08 ha" },
    ],
  },
  {
    id: "demo-c11",
    name: "C-11 South Slope",
    crop: "Barley",
    area_hectares: 22.4,
    location: "47.2152N, 2.0460E - Cher, FR",
    health: 64,
    notes: "Powdery mildew spreading. Recommend fungicide within 72h.",
    zones: [
      { x: -7, z: -4, w: 4, d: 3.5, severity: "high", label: "Mildew 1.6 ha" },
      { x: 3, z: 2, w: 4, d: 3, severity: "high", label: "Mildew 1.1 ha" },
      { x: 8, z: -3, w: 2.5, d: 2.5, severity: "medium", label: "Rust 0.4 ha" },
    ],
  },
];

export const DEMO_MISSIONS = [
  {
    id: "m1", field: "B-04 North Quadrant", drone: "AGV-04 DJI Agras T40",
    type: "spray", status: "in_progress", progress: 62,
    scheduled_at: "Today 14:20", chemical: "Lambda-cyhalothrin + Tebuconazole",
    dose: 0.8, area: 1.72, eta: "11 min",
  },
  {
    id: "m2", field: "C-11 South Slope", drone: "AGV-02 DJI Agras T30",
    type: "spray", status: "scheduled", progress: 0,
    scheduled_at: "Tomorrow 06:12", chemical: "Tebuconazole 250 EC",
    dose: 1.2, area: 3.1, eta: "16h",
  },
  {
    id: "m3", field: "A-02 River Bend", drone: "AGV-01 DJI Mavic 3M",
    type: "scan", status: "scheduled", progress: 0,
    scheduled_at: "Tomorrow 09:40", chemical: "-", dose: 0, area: 8.6, eta: "19h",
  },
  {
    id: "m4", field: "B-04 North Quadrant", drone: "AGV-01 DJI Mavic 3M",
    type: "scan", status: "completed", progress: 100,
    scheduled_at: "Today 10:05", chemical: "-", dose: 0, area: 14.2, eta: "done",
  },
];

export const DEMO_DRONES = [
  { id: "d1", name: "AGV-01 DJI Mavic 3M", role: "Scanner", status: "in_flight", battery: 64, signal: 92, location: "B-04" },
  { id: "d2", name: "AGV-02 DJI Agras T30", role: "Sprayer", status: "charging", battery: 38, signal: 100, location: "Hangar" },
  { id: "d3", name: "AGV-03 DJI Mavic 3M", role: "Scanner", status: "idle", battery: 98, signal: 100, location: "Hangar" },
  { id: "d4", name: "AGV-04 DJI Agras T40", role: "Sprayer", status: "in_flight", battery: 71, signal: 88, location: "B-04" },
];

export const DEMO_HEALTH_TREND = [
  { date: "May 01", health: 71 },
  { date: "May 04", health: 73 },
  { date: "May 07", health: 70 },
  { date: "May 10", health: 74 },
  { date: "May 13", health: 78 },
  { date: "May 16", health: 81 },
  { date: "May