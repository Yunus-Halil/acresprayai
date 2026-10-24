// UTM to latitude and longitude, for reading an orthophoto's own CRS in the developer scripts.

/** Latitude and longitude of a UTM point (WGS84; Snyder's series, well under a metre over a field). */
export function utmToLatLng(e: number, n: number, zone: number, south: boolean): { lat: number; lng: number } {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = e - 500000, y = south ? n - 10000000 : n;
  const m = y / k0, mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (1.5 * e1 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const c1 = ep2 * Math.cos(p1) ** 2, t1 = Math.tan(p1) ** 2, n1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, d = x / (n1 * k0);
  const lat = p1 - ((n1 * Math.tan(p1)) / r1) * (d * d / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lng = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(p1);
  return { lat: (lat * 180) / Math.PI, lng: (zone - 1) * 6 - 180 + 3 + (lng * 180) / Math.PI };
}
