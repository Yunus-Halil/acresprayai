// Client-side drone image preparation for ODM.
// CRITICAL: ODM needs GPS EXIF tags on every JPEG to produce a georeferenced
// orthomosaic. Canvas re-encoding strips EXIF, so we extract EXIF from the
// original file BEFORE downscaling, then re-inject it into the resized JPEG.
// Without this, ODM falls back to a local meter grid anchored at (0,0) and
// the resulting ortho lands in the Gulf of Guinea.
import piexif from "piexifjs";

function fileToDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function dataURLToBlob(dataURL: string): Blob {
  const [head, b64] = dataURL.split(",");
  const mime = /data:(.*?);base64/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Extract the EXIF segment (as a binary string) from a JPEG file. Returns "" on failure. */
async function getExifString(file: File): Promise<string> {
  if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return "";
  try {
    const url = await fileToDataURL(file);
    return piexif.dump(piexif.load(url));
  } catch {
    return "";
  }
}

/** True iff the JPEG has non-empty GPSLatitude + GPSLongitude tags. */
export async function hasGPS(file: File): Promise<boolean> {
  if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return false;
  try {
    const url = await fileToDataURL(file);
    const exif = piexif.load(url);
    const gps = exif?.GPS ?? {};
    const lat = gps[piexif.GPSIFD.GPSLatitude];
    const lng = gps[piexif.GPSIFD.GPSLongitude];
    return Array.isArray(lat) && lat.length === 3 && Array.isArray(lng) && lng.length === 3;
  } catch {
    return false;
  }
}

/**
 * Downscale a drone JPEG while preserving the original EXIF (including GPS).
 * Skips images already under 1.5 MB or with no oversized edge.
 */
export async function prepareForODM(
  file: File,
  maxEdge = 2400,
  quality = 0.82,
): Promise<File> {
  if (file.size < 1_500_000) return file;

  // Decode
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) { bitmap.close?.(); return file; }
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close?.(); return file; }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // Pull EXIF off the ORIGINAL before we throw it away
  const exifStr = await getExifString(file);

  const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) return file;

  let finalBlob: Blob = blob;
  if (exifStr) {
    try {
      const resizedDataURL = await fileToDataURL(blob);
      const merged = piexif.insert(exifStr, resizedDataURL);
      finalBlob = dataURLToBlob(merged);
    } catch {
      // If EXIF re-injection fails for any reason, fall back to the bare resized JPEG.
      finalBlob = blob;
    }
  }

  const newName = file.name.replace(/\.(png|tiff?|heic|webp)$/i, ".jpg");
  return new File([finalBlob], newName, { type: "image/jpeg", lastModified: file.lastModified });
}