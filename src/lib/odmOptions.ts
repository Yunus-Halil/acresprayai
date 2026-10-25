// What the scan asks OpenDroneMap for: the highest orthomosaic quality the
// photographs support, always.
//
// Without options the node runs ODM's defaults, and the default orthophoto
// resolution is 5 cm per pixel: a 1 cm camera comes back as a 5 cm map. ODM
// never renders finer than the ground sampling it measures from the photos
// (the requested resolution is capped by its GSD estimate unless ignore-gsd is
// set, which it never is here), so the request is set far below any flight:
// the orthophoto comes back at the photographs' own pixel, 1 cm from 25 m or
// 0.3 cm from 10 m. Until 2026-10-25 the request was 1 cm, which held a lower,
// sharper flight to 1 cm (docs/research/orthomosaic-resolution-audit-2026-10-24.md).
// A dense point cloud at high quality gives cleaner edges and a surface model
// (DSM) the ground projection can use later instead of a flat plane; the
// textured 3D model is skipped because nothing here reads it; the automatic
// boundary trims the ragged, unreliable rim of the mosaic. WebODM Lightning
// bills per image, not per option. Format: NodeODM's `[{ name, value }]`.
export type OdmOption = { name: string; value: string | number | boolean };

export const ODM_PROCESSING_OPTIONS: readonly OdmOption[] = [
  { name: "orthophoto-resolution", value: 0.1 },
  { name: "pc-quality", value: "high" },
  { name: "dsm", value: true },
  { name: "skip-3dmodel", value: true },
  { name: "auto-boundary", value: true },
];
