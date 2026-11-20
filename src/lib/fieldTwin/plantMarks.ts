// Which photographs marked each plant of a corn twin, and where in each (2026-11-20): kept in the analysis record (on
// the device, beside the twin), for the founder's "every photograph that saw it". A plant is drawn where its
// photographs' marks agree once the photographs are registered against each other, so a photograph's own mark of it
// can sit several centimetres from where the twin's place falls in that photograph: the mark's own pixel is the only
// sure way to show what the photograph marked.
//
// Packed: `start` one number a plant and one more (where its marks begin in `marks`), `marks` three numbers a mark
// (the photograph's index in `photos`, the pixel across and down in the full frame, rounded). Numbers only.
export type PackedPlantMarks = { version: 1; photos: string[]; /** Uint32, little-endian, base64: plants + 1. */ start: string; /** Uint16, little-endian, base64: 3 a mark. */ marks: string };
export type PlantMark = { photo: string; u: number; v: number };

const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

export function packPlantMarks(plants: readonly (readonly PlantMark[])[]): PackedPlantMarks {
  const photos: string[] = [], at = new Map<string, number>();
  const total = plants.reduce((t, p) => t + p.length, 0), start = new DataView(new ArrayBuffer(4 * (plants.length + 1))), marks = new DataView(new ArrayBuffer(6 * total));
  let k = 0;
  plants.forEach((list, i) => {
    start.setUint32(4 * i, k, true);
    for (const m of list) {
      let p = at.get(m.photo); if (p == null) { p = photos.length; photos.push(m.photo); at.set(m.photo, p); }
      marks.setUint16(6 * k, p, true); marks.setUint16(6 * k + 2, Math.max(0, Math.min(65535, Math.round(m.u))), true); marks.setUint16(6 * k + 4, Math.max(0, Math.min(65535, Math.round(m.v))), true); k++;
    }
  });
  start.setUint32(4 * plants.length, k, true);
  return { version: 1, photos, start: b64(new Uint8Array(start.buffer)), marks: b64(new Uint8Array(marks.buffer)) };
}

/** The marks of plant `index`, by a reader opened once; null when the record is not a version 1 record. */
export function plantMarksReader(P: PackedPlantMarks | null | undefined): ((index: number) => PlantMark[]) | null {
  if (!P || P.version !== 1 || !Array.isArray(P.photos) || typeof P.start !== "string" || typeof P.marks !== "string") return null;
  let start: DataView, marks: DataView;
  try { const s = unb64(P.start), m = unb64(P.marks); start = new DataView(s.buffer); marks = new DataView(m.buffer); } catch { return null; }
  const n = start.byteLength / 4 - 1;
  if (n < 0 || !Number.isInteger(n) || marks.byteLength % 6 !== 0) return null;
  return index => {
    if (!(index >= 0 && index < n)) return [];
    const a = start.getUint32(4 * index, true), b = Math.min(start.getUint32(4 * index + 4, true), marks.byteLength / 6), out: PlantMark[] = [];
    for (let k = a; k < b; k++) { const photo = P.photos[marks.getUint16(6 * k, true)]; if (photo != null) out.push({ photo, u: marks.getUint16(6 * k + 2, true), v: marks.getUint16(6 * k + 4, true) }); }
    return out;
  };
}
