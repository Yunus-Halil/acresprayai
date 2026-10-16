// What the scan asks OpenDroneMap for: the highest orthomosaic quality the
// photographs support, always.
//
// Without options the node runs ODM's defaults, and the default orthophoto
// resolution is 5 cm per pixel: a 1 cm camera comes back as a 5 cm map. ODM
// never renders finer than the ground sampling it measures from the photos,
// so asking for 1 cm is "as fine as the data allows", not an upsample. A
// dense point cloud at high quality gives cleaner edges and a surface model
// (DSM) the ground projection can use later instead of a flat plane; the
// textured 3D model is skipped because nothing here reads it; the automatic
// boundary trims the ragged, unreliable rim of the mosaic. WebODM Lightning
// bills per image, not per option. Format: NodeODM's `[{ name, value }]`.
export type OdmOption = { name: string; value: string | number | boolean };

export const ODM_PROCESSING_OPTIONS: readonly OdmOption[] = [
  { name: "orthophoto-resolution", value: 1 },
  { name: "pc-quality", value: "high" },
  { name: "dsm", value: true },
  { name: "skip-3dmodel", value: true },
  { name: "auto-boundary", value: true },
];
