// Vegetation structure: individuals, clusters and coverage zones, at the scale the imagery supports. See types.ts.
export * from "./types";
export { groupVegetation, linkByGap, accountingGap, polygonArea, type GroupInput, type Bounds } from "./group";
export { itemsFromPhoto, structureOfPhoto } from "./photo";
export { structureOfMap, type MapStructureInput } from "./map";
export { groundStructure, mergeGroundStructures, emptyGroundStructure, type GroundStructure, type GroundIndividual, type GroundCluster, type GroundZone } from "./ground";
