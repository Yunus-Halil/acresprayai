// A corn plant, selected (the founder's, under photo ground's own rule: photoGroundFlag.ts): every photograph that
// saw it, cut on demand from the flight's own files on this device (PhotoEvidence, as a selected weed's), with the
// plants the twin located around it ringed in their colours, on a row or off the rows. For checking the plants drawn
// off the rows, and the ones that stand very close to a plant on a row, by eye. Nothing is kept or uploaded.
//
// The cameras and each photograph's own marks: the corn twin's analysis record, read once when the first plant is
// selected (`cameras`); each crop is aligned on the photograph's own marks of the plants around the selected one
// (photoAccess.ts alignOnMarks: the twin's plants are merged from several photographs, registered against each other,
// so through one camera alone they miss that photograph's marks by centimetres). Without the record, photo ground's
// cameras, not aligned.
import { useEffect, useMemo, useState } from "react";
import type { GeorefFrame } from "@/lib/directGeoref/projection";
import { CORN_RENDER, isOnRow, rgbCss } from "@/lib/fieldTwin/cornRender";
import type { PhotoAccess } from "@/lib/fieldTwin/photoAccess";
import type { PlantCameras } from "@/lib/fieldTwin/plantCameras";
import type { LatLngPair } from "@/lib/fieldTwin/types";
import { PhotoEvidence } from "./PhotoGround";

/** What the founder's plant photographs read: the crop, the rings, how far around the plant its neighbours are looked for. */
export const PLANT_PHOTOS = {
  windowM: 0.6, markM: 0.06, max: 24, px: 480, neighbourM: 0.45, maxNeighbours: 60, scaleM: 0.1,
  /** Rings that stand out on green leaves and tan soil alike: amber on a row, the map's own blue off the rows. */
  onRowColour: "#ffb627", offRowColour: rgbCss(CORN_RENDER.offRow),
};

export type CameraSource = () => Promise<PlantCameras | null>;
type Plants = { points: LatLngPair[]; certainty?: number[] | null; photos?: number[] | null };

const M_PER_DEG = 111_320;
/** Metres between two nearby places (an equirectangular step: exact enough over a metre). */
const metresApart = (a: LatLngPair, b: LatLngPair) => Math.hypot((a[0] - b[0]) * M_PER_DEG, (a[1] - b[1]) * M_PER_DEG * Math.cos((a[0] * Math.PI) / 180));

/** The located plants within `radiusM` of plant `index` (itself left out), nearest first. */
export function plantNeighbours(plants: Plants, index: number, radiusM: number = PLANT_PHOTOS.neighbourM, max: number = PLANT_PHOTOS.maxNeighbours): { i: number; d: number; onRow: boolean }[] {
  const p = plants.points[index]; if (!p) return [];
  const dLat = radiusM / M_PER_DEG, out: { i: number; d: number; onRow: boolean }[] = [];
  plants.points.forEach((q, i) => {
    if (i === index || Math.abs(q[0] - p[0]) > dLat * 1.01) return;
    const d = metresApart(p, q);
    if (d <= radiusM) out.push({ i, d, onRow: plants.certainty ? isOnRow(plants.certainty[i]) : true });
  });
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}

const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;

export default function PlantPhotos({ plants, index, lat, lng, groundFrames, cameras, access, setAccess }: {
  plants: Plants; index: number; lat: number; lng: number;
  /** Photo ground's cameras, when the twin has photo ground. */ groundFrames: GeorefFrame[] | null;
  /** Otherwise the analysis record's cameras (read once by the page). */ cameras: CameraSource | null;
  access: PhotoAccess | null; setAccess: (a: PhotoAccess) => void;
}) {
  const [loaded, setLoaded] = useState<{ status: "loading" | "ready" | "none" | "error"; cams: PlantCameras | null; error?: string }>({ status: "loading", cams: null });
  useEffect(() => {
    if (!cameras) { setLoaded({ status: "none", cams: null }); return; }
    let live = true;
    cameras().then(c => { if (live) setLoaded(c?.frames.length ? { status: "ready", cams: c } : { status: "none", cams: null }); })
      .catch(e => { if (live) setLoaded({ status: "error", cams: null, error: (e as Error).message }); });
    return () => { live = false; };
  }, [cameras]);
  // The record's cameras, aligned on its marks; photo ground's, not aligned, only where there is no record.
  const waiting = !!cameras && loaded.status === "loading";
  const frames: GeorefFrame[] | null = loaded.cams?.frames ?? (waiting ? null : groundFrames);
  const marks = loaded.cams?.marks ?? null;
  const near = useMemo(() => plantNeighbours(plants, index), [plants, index]);
  const others = useMemo(() => near.map(n => ({ lat: plants.points[n.i][0], lng: plants.points[n.i][1], colour: n.onRow ? PLANT_PHOTOS.onRowColour : PLANT_PHOTOS.offRowColour })), [near, plants]);
  const onRow = plants.certainty ? isOnRow(plants.certainty[index]) : true;
  const nearestOnRow = near.find(n => n.onRow), nearest = near[0];
  const located = plants.photos?.[index];
  const intro = (
    <div className="mb-2 space-y-0.5 text-[11px] leading-snug text-neutral-300" aria-label="Around this plant">
      <p>This plant is drawn {onRow ? "on a row" : "off the rows"}{located != null ? `; ${located} photograph${located === 1 ? "" : "s"} located it` : ""}.</p>
      {nearest
        ? <p>Nearest plant the twin located: {cm(nearest.d)} away, {nearest.onRow ? "on a row" : "off the rows"}.{nearestOnRow && nearestOnRow !== nearest ? ` Nearest on a row: ${cm(nearestOnRow.d)}.` : ""}</p>
        : <p>No other plant located within {cm(PLANT_PHOTOS.neighbourM)}.</p>}
    </div>
  );
  if (!frames) {
    return (
      <section className="mt-3 border-t border-[#2e322e] pt-3" aria-label="Every photograph that saw it">
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">Every photograph that saw it</h3>
        {intro}
        <p className="text-[11px] leading-snug text-neutral-500">
          {loaded.status === "loading" ? "Reading the cameras the build aligned…"
            : loaded.status === "error" ? `Could not read the cameras the build aligned (${loaded.error}).`
            : "This twin keeps no record of its cameras (built before the record was kept, or not on this account), so its photographs cannot be matched to the plant. Building it again keeps one."}
        </p>
      </section>
    );
  }
  return (
    <PhotoEvidence frames={frames} access={access} setAccess={setAccess} lat={lat} lng={lng} what="this plant"
      windowM={PLANT_PHOTOS.windowM} markM={PLANT_PHOTOS.markM} max={PLANT_PHOTOS.max} px={PLANT_PHOTOS.px} others={others} intro={intro} northUp scaleM={PLANT_PHOTOS.scaleM} lead marks={marks}
      legend={<>Other plants the twin located: <span className="font-semibold" style={{ color: PLANT_PHOTOS.onRowColour }}>amber, on a row</span>; <span className="font-semibold" style={{ color: PLANT_PHOTOS.offRowColour }}>blue, off the rows</span> (blue on the map too).</>} />
  );
}
