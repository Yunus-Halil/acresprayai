// The photograph check: before anything is built, read every file's header once and say, in plain words, which
// photographs Swardus can use, which it cannot and why, and whether the flight suits the crop. Nothing is dropped
// silently: a photograph left out is counted and named here, and only the photographs this check passes are given
// to the build.
//
// The rules follow what the build actually needs (lib/directGeoref/frame.ts: a position, the DJI height above
// take-off and gimbal angles, an image size, a focal length) plus what the pilot has been tested on. The numbers in
// PILOT_LIMITS are the pilot's envelope; set them from the real-flight validation run, not from guesses.
import { type DjiPhotoMeta, parseDjiHeader } from "@/lib/directGeoref/metadata";
import { frameFromDji } from "@/lib/directGeoref/frame";

export type CheckCrop = "corn" | "orchard";
export type CheckAudience = "founder" | "participant";

export const PILOT_LIMITS = {
  /** The build cannot place fewer. */
  minPhotographs: 2,
  /** Below this a twin covers very little; said, not refused. */
  fewPhotographs: 10,
  /** The largest flight built end to end so far (the apricot flight). Above it: said, not refused. */
  testedPhotographs: 71,
  /** Refused for participants above this: the camera fit's dense solve and the browser's memory (derived wall about
   * 300 to 500, docs/research/swardus-direct-limits-2026-11-02.md). The founder is warned instead. */
  maxPhotographs: 400,
  /** DJI writes -90 for straight down. More than this away from it is an oblique photograph. */
  maxOffNadirDeg: 15,
  /** Ground per pixel the crop reader needs, cm. Coarser is said, not refused. */
  maxGsdCm: { corn: 1.5, orchard: 5 } as Record<CheckCrop, number>,
  /** Photographs further apart than this in time or space are probably two flights. */
  sameFlightHours: 6,
  sameFlightKm: 3,
} as const;

/** One file as the check sees it: its name, its folder path when picked as a folder, and its header (or why not). */
export type CheckInput = { name: string; path: string; size: number; meta: DjiPhotoMeta | null; error?: string };

export type CheckFinding = {
  level: "stop" | "warning" | "note";
  text: string;
  /** The files it is about (a few are shown; the count is in the text). */
  files?: string[];
};

export type PhotoCheck = {
  totalFiles: number;
  /** Names (unique) of the photographs the build will use, in file-name order. */
  usable: string[];
  findings: CheckFinding[];
  camera: string | null;
  /** Median ground per pixel at the image centre on flat ground, cm. */
  gsdCm: number | null;
  /** The ground the usable photographs cover, hectares (footprints on flat ground). */
  areaHa: number | null;
  capturedAt: string | null;
  rtk: "all" | "some" | "none";
  canBuild: boolean;
};

const PHOTO_EXT = /\.(jpe?g|tiff?)$/i;
const TIFF_EXT = /\.tiff?$/i;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const examples = (names: string[]) => names.slice(0, 5);

/** The reason a photograph cannot be used, in the operator's words: [one photograph, several]. */
function plainReason(reason: string): [string, string] {
  if (/header unreadable|could not be read/i.test(reason)) return ["could not be read (damaged, or not a photograph)", "could not be read (damaged, or not photographs)"];
  if (/no camera position/i.test(reason)) return ["has no position in the file (the drone's GPS was off, or the file was edited)", "have no position in the file (the drone's GPS was off, or the files were edited)"];
  if (/RelativeAltitude|gimbal/i.test(reason)) return ["lacks the drone's height and camera angle: it is not from a DJI drone, or was edited and re-saved", "lack the drone's height and camera angle: they are not from a DJI drone, or were edited and re-saved"];
  if (/image size/i.test(reason)) return ["carries no image size", "carry no image size"];
  if (/focal length/i.test(reason)) return ["carries no lens information", "carry no lens information"];
  if (/rescale|cropped/i.test(reason)) return ["was cropped or resized", "were cropped or resized"];
  return [reason, reason];
}

/** Footprint area of the usable photographs, on a grid in local metres (a union, so overlap is not counted twice). */
function coveredHa(frames: { lat: number; lng: number; wM: number; hM: number; yawDeg: number }[]): number | null {
  if (!frames.length) return null;
  const lat0 = frames[0].lat, lng0 = frames[0].lng;
  const mPerLat = 111_320, mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const cell = Math.max(0.5, Math.min(...frames.map(f => Math.min(f.wM, f.hM))) / 8);
  const cells = new Set<string>();
  for (const f of frames) {
    const cx = (f.lng - lng0) * mPerLng, cy = (f.lat - lat0) * mPerLat;
    const a = (f.yawDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const r = Math.hypot(f.wM, f.hM) / 2;
    for (let x = Math.floor((cx - r) / cell); x <= Math.ceil((cx + r) / cell); x++) {
      for (let y = Math.floor((cy - r) / cell); y <= Math.ceil((cy + r) / cell); y++) {
        // The cell centre in the photograph's own axes (the image's top points along the gimbal yaw).
        const dx = (x + 0.5) * cell - cx, dy = (y + 0.5) * cell - cy;
        const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
        if (Math.abs(u) <= f.wM / 2 && Math.abs(v) <= f.hM / 2) cells.add(`${x},${y}`);
      }
    }
  }
  return (cells.size * cell * cell) / 10_000;
}

const distanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const mPerLng = 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111.32, (a.lng - b.lng) * mPerLng);
};

/** Assess a picked set of files. Pure: the headers are already read (see readForCheck). */
export function assessPhotographs(inputs: CheckInput[], crop: CheckCrop | null, audience: CheckAudience = "participant", otherFiles = 0): PhotoCheck {
  const findings: CheckFinding[] = [];
  const founder = audience === "founder";
  if (otherFiles > 0) findings.push({ level: "note", text: `${plural(otherFiles, "file")} skipped because ${otherFiles === 1 ? "it is" : "they are"} not a JPEG photograph (videos, RAW or other files).` });

  // Two files with one name are almost always two flights or two memory-card folders in one pick.
  const byName = new Map<string, CheckInput[]>();
  for (const i of inputs) byName.set(i.name, [...(byName.get(i.name) ?? []), i]);
  const duplicates = [...byName.values()].filter(g => g.length > 1);
  if (duplicates.length) {
    findings.push({ level: "stop", text: `${plural(duplicates.length, "file name")} appear${duplicates.length === 1 ? "s" : ""} in more than one folder (for example ${duplicates[0][0].name}). That usually means more than one flight was picked. Pick one flight's folder.`, files: examples(duplicates.flat().map(d => d.path)) });
  }

  const tiffs = inputs.filter(i => TIFF_EXT.test(i.name));
  const candidates = founder ? inputs : inputs.filter(i => !TIFF_EXT.test(i.name));
  if (!founder && tiffs.length) findings.push({ level: "warning", text: `${plural(tiffs.length, "TIFF file")} left out: the pilot reads the drone's JPEG photographs. Pick the .JPG files.`, files: examples(tiffs.map(t => t.path)) });

  const refusedBy = new Map<string, { words: [string, string]; paths: string[] }>();
  const refuse = (path: string, reason: string) => { const words = plainReason(reason); const g = refusedBy.get(words[1]) ?? { words, paths: [] }; g.paths.push(path); refusedBy.set(words[1], g); };
  type Ok = { input: CheckInput; meta: DjiPhotoMeta; gsdM: number; wM: number; hM: number; rtk: boolean };
  const ok: Ok[] = [];
  const oblique: string[] = [];
  for (const i of candidates) {
    if (!i.meta) { refuse(i.path, i.error ?? "header unreadable"); continue; }
    const f = frameFromDji(i.name, i.meta);
    if (!f.ok) { refuse(i.path, (f as { reason: string }).reason); continue; }
    const pitch = i.meta.gimbalPitchDeg!;
    if (Math.abs(pitch + 90) > PILOT_LIMITS.maxOffNadirDeg) { oblique.push(i.path); continue; }
    const fx = f.frame.intrinsics.fx, alt = f.frame.pose.altM;
    const gsdM = alt > 0 && fx > 0 ? alt / fx : NaN;
    ok.push({ input: i, meta: i.meta, gsdM, wM: gsdM * f.frame.intrinsics.width, hM: gsdM * f.frame.intrinsics.height, rtk: i.meta.rtkFlag === 50 });
  }
  for (const { words, paths } of refusedBy.values()) findings.push({ level: "warning", text: `${plural(paths.length, "photograph")} left out: ${paths.length === 1 ? `it ${words[0]}` : `they ${words[1]}`}.`, files: examples(paths) });
  if (oblique.length) findings.push({ level: "warning", text: `${plural(oblique.length, "photograph")} left out: taken with the camera tilted, not pointing straight down.`, files: examples(oblique) });

  const usableOk = duplicates.length ? [] : ok;
  const n = usableOk.length;
  if (!duplicates.length) {
    if (n < PILOT_LIMITS.minPhotographs) {
      findings.push({ level: "stop", text: n === 0 ? "None of these photographs can be used, so there is nothing to build." : "Only one photograph can be used. A Field Twin needs overlapping photographs from a flight." });
    } else if (n < PILOT_LIMITS.fewPhotographs) {
      findings.push({ level: "note", text: `Only ${plural(n, "photograph")}: the twin will cover a small piece of ground.` });
    }
    if (n > PILOT_LIMITS.maxPhotographs) {
      findings.push({ level: founder ? "warning" : "stop", text: `${n.toLocaleString()} photographs is more than the pilot can build in a browser (up to ${PILOT_LIMITS.maxPhotographs}). Build one block of the field at a time: pick the photographs of one part.` });
    } else if (n > PILOT_LIMITS.testedPhotographs) {
      findings.push({ level: "note", text: `${n.toLocaleString()} photographs is more than Swardus has been tried on so far (about ${PILOT_LIMITS.testedPhotographs}). It should work, but it will take longer and use more of the computer's memory.` });
    }
  }

  const cameras = new Map<string, number>();
  for (const o of usableOk) { const c = [o.meta.make, o.meta.model].filter(Boolean).join(" ") || "an unnamed camera"; cameras.set(c, (cameras.get(c) ?? 0) + 1); }
  const camerasSorted = [...cameras.entries()].sort((a, b) => b[1] - a[1]);
  if (camerasSorted.length > 1) findings.push({ level: "warning", text: `The photographs come from ${camerasSorted.length} cameras (${camerasSorted.map(([c, k]) => `${c}: ${k}`).join(", ")}). One flight with one drone gives the best twin.` });

  const gsdCm = median(usableOk.map(o => o.gsdM * 100).filter(Number.isFinite));
  if (crop && gsdCm != null && gsdCm > PILOT_LIMITS.maxGsdCm[crop]) {
    findings.push({ level: "warning", text: crop === "corn"
      ? `These photographs show about ${gsdCm.toFixed(1)} cm of ground per pixel; reading corn plants needs about 1 cm. Expect rows at best and few or no plant-level findings. Flying lower gives a better twin.`
      : `These photographs show about ${gsdCm.toFixed(1)} cm of ground per pixel; trees and weeds read best at ${PILOT_LIMITS.maxGsdCm.orchard} cm or finer.` });
  }

  const times = usableOk.map(o => (o.meta.capturedAt ? Date.parse(o.meta.capturedAt.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length > 1 && (times[times.length - 1] - times[0]) / 3_600_000 > PILOT_LIMITS.sameFlightHours) {
    findings.push({ level: "warning", text: "These photographs were taken more than six hours apart: they may be from more than one flight. A twin should be built from one flight." });
  }
  if (usableOk.length > 1) {
    const far = usableOk.some(o => distanceKm(o.meta as { lat: number; lng: number }, usableOk[0].meta as { lat: number; lng: number }) > PILOT_LIMITS.sameFlightKm);
    if (far) findings.push({ level: "warning", text: "Some photographs were taken more than 3 km from the others: they may be from another field. A twin should be one field or block." });
  }

  const rtkCount = usableOk.filter(o => o.rtk).length;
  const rtk: PhotoCheck["rtk"] = !n ? "none" : rtkCount === n ? "all" : rtkCount ? "some" : "none";
  if (n && rtk !== "all") findings.push({ level: "note", text: "Positions come from the drone's GPS without RTK: expect the whole twin to sit a metre or a few off satellite imagery. Distances within the field are much closer than that." });

  const areaHa = coveredHa(usableOk.filter(o => Number.isFinite(o.wM)).map(o => ({ lat: o.meta.lat!, lng: o.meta.lng!, wM: o.wM, hM: o.hM, yawDeg: o.meta.gimbalYawDeg ?? 0 })));
  const capturedAt = usableOk.map(o => o.meta.capturedAt).filter((c): c is string => !!c).sort()[0] ?? null;
  const canBuild = !findings.some(f => f.level === "stop") && !!crop;
  return {
    totalFiles: inputs.length + otherFiles,
    usable: usableOk.map(o => o.input.name).sort((a, b) => a.localeCompare(b)),
    findings, camera: camerasSorted[0]?.[0] ?? null, gsdCm, areaHa, capturedAt, rtk, canBuild,
  };
}

const HEADER_BYTES = 1 << 20;

/** Read the headers of a picked set (the browser side of the check). Files that are not photographs are counted. */
export async function readForCheck(files: File[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ inputs: CheckInput[]; otherFiles: number }> {
  const photos = files.filter(f => PHOTO_EXT.test(f.name));
  const inputs: CheckInput[] = [];
  for (let k = 0; k < photos.length; k++) {
    if (signal?.aborted) break;
    const f = photos[k];
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    try {
      const meta = parseDjiHeader(new Uint8Array(await f.slice(0, HEADER_BYTES).arrayBuffer()));
      inputs.push({ name: f.name, path, size: f.size, meta });
    } catch (e) {
      inputs.push({ name: f.name, path, size: f.size, meta: null, error: `header unreadable: ${(e as Error).message}` });
    }
    if (k % 10 === 9) { onProgress?.(k + 1, photos.length); await new Promise(r => setTimeout(r, 0)); }
  }
  onProgress?.(photos.length, photos.length);
  return { inputs, otherFiles: files.length - photos.length };
}
