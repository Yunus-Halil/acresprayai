/**
 * The website's specimen: weed 1678 of the apricot Field Twin (apricot-2021-04-27), a verified candidate seen
 * in 12 of the 12 photographs that covered it. The numbers are the twin's own measurements, copied from the
 * bundle; the outlines are the detector's, in the pixels of the 320 px crops in public/site/plant/photo-N.jpg.
 * Regenerate both with scripts/site/plantPhotos.py if the twin is rebuilt. Nothing here is rounded for looks.
 */
export const SPECIMEN = {
  id: 1678,
  /** Diameter of a circle with the measured area, metres. */
  diameterM: 0.3708,
  areaM2: 0.108,
  seenBy: 12,
  coveredBy: 12,
  /** Each crop is 320 px of the original photograph, about 3.1 m of ground at 0.97 cm per pixel. */
  cropPx: 320,
  photos: [
    { src: "/site/plant/photo-1.jpg", poly: [[165,180.5],[162,180.5],[155,173.5],[138,165.5],[135.5,162],[138.5,154],[144,148.5],[163,145.5],[170,141.5],[172,141.5],[178.5,144],[178.5,149],[174.5,158],[175.5,170],[170.5,178],[165,180.5]] },
    { src: "/site/plant/photo-2.jpg", poly: [[148,179.5],[145.5,177],[145.5,175],[143.5,174],[142.5,168],[143.5,167],[143.5,159],[147.5,152],[147.5,146],[149.5,143],[149.5,139],[152,133.5],[156.5,135],[157.5,139],[165,148.5],[168,149.5],[176,157.5],[183.5,162],[185.5,170],[181,174.5],[177,176.5],[158,173.5],[151,175.5],[148,179.5]] },
    { src: "/site/plant/photo-3.jpg", poly: [[169,187.5],[165,185.5],[162,185.5],[158.5,180],[158.5,178],[155,174.5],[150,172.5],[136.5,161],[133.5,156],[132.5,148],[137,143.5],[145,143.5],[152,146.5],[161,146.5],[165.5,143],[166.5,140],[170,136.5],[175.5,141],[178.5,147],[178.5,156],[180.5,164],[174,167.5],[170.5,172],[170.5,185],[169,187.5]] },
    { src: "/site/plant/photo-4.jpg", poly: [[148,179.5],[147,178.5],[146,179.5],[143.5,179],[138.5,168],[141.5,156],[144.5,152],[144.5,149],[143,147.5],[140,147.5],[136,145.5],[132,145.5],[131.5,143],[133,141.5],[141,141.5],[144,142.5],[148,146.5],[149.5,136],[153,134.5],[166,146.5],[176,150.5],[184.5,152],[185.5,160],[182.5,165],[183.5,168],[177,176.5],[172,174.5],[158,173.5],[155,176.5],[148,179.5]] },
  ] as { src: string; poly: [number, number][] }[],
};

/** US units first (the page is written for US farmers), metric beside them. */
export const specimenSizes = () => {
  const inches = SPECIMEN.diameterM / 0.0254;
  const sqft = SPECIMEN.areaM2 * 10.7639;
  return {
    across: `${Math.round(inches)} in`,
    acrossMetric: `${Math.round(SPECIMEN.diameterM * 100)} cm`,
    ground: `${sqft.toFixed(1)} sq ft`,
    groundMetric: `${SPECIMEN.areaM2.toFixed(2)} m²`,
  };
};
