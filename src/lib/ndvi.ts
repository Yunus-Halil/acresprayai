// Client-side NDVI proxy sampling from an orthomosaic image.
// Works on both true colorized NDVI exports (red->green palette) and plain RGB orthos
// using the visible-band vegetation index (G-R)/(G+R).

export type LatLng = { lat: number; lng: number };
export type Bounds = { north: number; south: number; east: number; west: number };

export function pointInPolygon(pt: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat;
    const xj = poly[j].lng, yj = poly[j].lat;
    const intersect = ((yi > pt.lat) !== (yj > pt.lat)) &&
      (pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load image: ${res.status}`);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

export type ZoneStats = {
  ndvi_mean: number;
  ndvi_p10: number;
  ndvi_p90: number;
  stressed_pct: number;
  sample_count: number;
};

/**
 * Sample an image inside a polygon and return NDVI-proxy statistics.
 * Index used: (G - R) / (G + R), normalized roughly to [0,1].
 */
export function sampleZoneStats(
  img: ImageBitmap,
  bounds: Bounds,
  polygon: LatLng[],
  maxSamples = 4000,
): ZoneStats {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  // Polygon bounding box
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const latRange = bounds.north - bounds.south;
  const lngRange = bounds.east - bounds.west;
  const toPx = (lat: number, lng: number) => ({
    x: Math.round(((lng - bounds.west) / lngRange) * img.width),
    y: Math.round(((bounds.north - lat) / latRange) * img.height),
  });

  // Choose a grid that yields ~maxSamples points inside the bbox
  const bboxArea = (maxLat - minLat) * (maxLng - minLng);
  const step = Math.max(0.000001, Math.sqrt(bboxArea / maxSamples));

  const values: number[] = [];
  for (let lat = minLat; lat <= maxLat; lat += step) {
    for (let lng = minLng; lng <= maxLng; lng += step) {
      if (!pointInPolygon({ lat, lng }, polygon)) continue;
      const { x, y } = toPx(lat, lng);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const px = ctx.getImageData(x, y, 1, 1).data;
      const r = px[0], g = px[1];
      // Skip transparent / no-data
      if (px[3] < 10) continue;
      const denom = g + r;
      if (denom < 5) continue; // black no-data
      const idx = (g - r) / denom; // -1..1
      // Map to NDVI-like 0..1 range (clamp)
      const ndvi = Math.max(0, Math.min(1, (idx + 1) / 2 * 1.4 - 0.2));
      values.push(ndvi);
    }
  }

  if (values.length === 0) {
    return { ndvi_mean: 0, ndvi_p10: 0, ndvi_p90: 0, stressed_pct: 0, sample_count: 0 };
  }
  values.sort((a, b) => a - b);
  const pct = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const stressed = values.filter(v => v < 0.4).length / values.length;
  return {
    ndvi_mean: +mean.toFixed(3),
    ndvi_p10: +pct(0.1).toFixed(3),
    ndvi_p90: +pct(0.9).toFixed(3),
    stressed_pct: +stressed.toFixed(3),
    sample_count: values.length,
  };
}

/** Parse a GeoTIFF blob client-side and return its geographic bounds + pixel size. */
export async function parseGeoTiff(file: File): Promise<{
  bounds: Bounds; gsd_m_per_px: number; width: number; height: number;
} | null> {
  try {
    const { fromBlob } = await import("geotiff");
    const tiff = await fromBlob(file);
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
    const width = image.getWidth();
    const height = image.getHeight();
    const [resX] = image.getResolution();
    // GSD in meters: approximate using 1 deg lat ≈ 111_320 m if degrees
    let gsd = Math.abs(resX);
    if (Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180) {
      gsd = Math.abs(resX) * 111_320;
    }
    return {
      bounds: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
      gsd_m_per_px: +gsd.toFixed(3),
      width, height,
    };
  } catch (e) {
    console.warn("GeoTIFF parse failed:", e);
    return null;
  }
}

/** PostGIS polygon WKT from a LatLng ring (auto-closes). */
export function ringToWKT(ring: LatLng[]): string {
  const closed = ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng
    ? ring : [...ring, ring[0]];
  const coords = closed.map(p => `${p.lng} ${p.lat}`).join(", ");
  return `SRID=4326;POLYGON((${coords}))`;
}