// Photo ground in the viewer (behind its flag): the panel (show the photographs under the twin, what they are, the
// flight's own files on this device, sharper photographs for the view) and the photographs behind a selected finding.
// Everything here reads files on this device; nothing is uploaded.
import { useEffect, useRef, useState } from "react";
import type { GroundManifest } from "@/lib/fieldTwin/photoGround";
import { type EvidenceView, type PhotoAccess, evidenceViews, photoAccessFrom, photosMatched } from "@/lib/fieldTwin/photoAccess";

const panel = "rounded-md border border-[#343834] bg-[#171a17]";

function OpenPhotos({ manifest, onAccess, label }: { manifest: GroundManifest; onAccess: (a: PhotoAccess) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="mt-1">
      <button type="button" className="rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26]" onClick={() => input.current?.click()}>{label}</button>
      <input ref={input} type="file" multiple accept=".jpg,.jpeg,.JPG,.JPEG,.tif,.tiff" className="hidden" aria-label="The flight's photographs on this device"
        onChange={e => {
          const files = e.target.files; if (!files?.length) return;
          const a = photoAccessFrom(files, "opened on this device"), n = photosMatched(a, manifest.frames);
          if (!n) { setNote(`None of these ${files.length} files is one of this twin's ${manifest.frames.length} photographs.`); return; }
          setNote(n < manifest.frames.length ? `${n} of the twin's ${manifest.frames.length} photographs found; the others are not on this device.` : null);
          onAccess(a);
          e.target.value = "";
        }} />
      <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">Read on this device only, never uploaded.</p>
      {note && <p className="mt-0.5 text-[10px] leading-snug text-amber-300/90">{note}</p>}
    </div>
  );
}

export type DetailState = { busy: boolean; note: string | null; tiles: number };

/** The left-column panel: the photographs under the twin. */
export function PhotoGroundPanel({ manifest, shown, setShown, access, setAccess, detail, onDetail }: { manifest: GroundManifest; shown: boolean; setShown: (v: boolean) => void; access: PhotoAccess | null; setAccess: (a: PhotoAccess) => void; detail: DetailState; onDetail: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`w-[272px] px-3 py-2 text-xs ${panel}`} role="group" aria-label="Photographs">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-neutral-100">
          <input type="checkbox" className="accent-[#f0a63a]" checked={shown} onChange={e => setShown(e.target.checked)} />The flight's photographs
        </label>
        <button type="button" className="text-[10px] text-neutral-400 hover:text-neutral-200" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? "less" : "what is this"}</button>
      </div>
      {open && <p className="mt-1 text-[10px] leading-snug text-neutral-400">{manifest.note} Overview at {manifest.overview.pixelCm} cm a pixel, from {manifest.overview.source}. The twin's marks are what Swardus located; the photographs show what was there, including plants it did not locate.</p>}
      {shown && <>
        {access
          ? <div className="mt-1.5">
            <p className="text-[10px] leading-snug text-neutral-400">{photosMatched(access, manifest.frames)} of {manifest.frames.length} photographs on this device ({access.source}).</p>
            <button type="button" disabled={detail.busy} className="mt-1 rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26] disabled:opacity-50" onClick={onDetail}>{detail.busy ? "Cutting the photographs…" : "Sharper photographs for this view"}</button>
            <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">{manifest.detail.pixelCm} cm a pixel, from the full photographs; kept while this page is open{detail.tiles ? ` (${detail.tiles} tiles)` : ""}.</p>
            {detail.note && <p className="mt-0.5 text-[10px] leading-snug text-amber-300/90">{detail.note}</p>}
          </div>
          : <OpenPhotos manifest={manifest} onAccess={setAccess} label="Open the flight's photographs for detail and evidence" />}
      </>}
    </div>
  );
}

/** The photographs behind a selected place: each photograph that saw it, nearest nadir first, the place marked. */
export function PhotoEvidence({ manifest, access, setAccess, lat, lng, what, windowM = 1.2, markM = 0.12 }: { manifest: GroundManifest; access: PhotoAccess | null; setAccess: (a: PhotoAccess) => void; lat: number; lng: number; what: string; /** Crop size and ring size, metres (the object's own size). */ windowM?: number; markM?: number }) {
  // The answer for one place at a time: until the views of THIS place are in, it says it is reading (never "none").
  const key = `${lat},${lng}`;
  const [state, setState] = useState<{ key: string | null; views: EvidenceView[]; missing: string[]; error: string | null }>({ key: null, views: [], missing: [], error: null });
  const [big, setBig] = useState<number | null>(null);
  useEffect(() => {
    if (!access) return;
    let live = true;
    evidenceViews(access, manifest.frames, lat, lng, { windowM, markM }).then(r => { if (live) setState({ key, ...r, error: null }); else r.views.forEach(v => URL.revokeObjectURL(v.url)); })
      .catch(e => { if (live) setState({ key, views: [], missing: [], error: (e as Error).message }); });
    return () => { live = false; };
  }, [access, manifest, lat, lng, key, windowM, markM]);
  const busy = !!access && state.key !== key;
  useEffect(() => () => { state.views.forEach(v => URL.revokeObjectURL(v.url)); }, [state.views]);
  return (
    <section className="mt-3 border-t border-[#2e322e] pt-3" aria-label="Every photograph that saw it">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">Every photograph that saw it</h3>
      {!access && <><p className="text-[11px] leading-snug text-neutral-400">See {what} in every photograph that saw it, at full resolution, from the flight's own files.</p><OpenPhotos manifest={manifest} onAccess={setAccess} label="Open the flight's photographs" /></>}
      {busy && <p className="text-[11px] text-neutral-500">Reading the photographs…</p>}
      {access && !busy && state.error && <p className="text-[11px] text-red-300">Could not read the photographs: {state.error}</p>}
      {access && !busy && !state.error && !state.views.length && <p className="text-[11px] text-neutral-500">{state.missing.length ? `The photographs that saw it (${state.missing.join(", ")}) are not on this device.` : "No photograph's footprint holds this place."}</p>}
      {!busy && state.views.length > 0 && <>
        <div className="flex flex-wrap gap-2">
          {state.views.map((v, i) => (
            <button key={v.name} type="button" className="text-left" onClick={() => setBig(big === i ? null : i)} aria-label={`${what} in ${v.name}`}>
              <img src={v.url} alt="" width={big === i ? 300 : 146} height={big === i ? 300 : 146} className="rounded-sm border border-[#3a3f3a]" />
              <span className="mt-0.5 block text-[10px] text-neutral-400">{v.name} · {v.nadirM.toFixed(1)} m from below the camera</span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-neutral-500">Each crop {+state.views[0].widthM.toFixed(2)} m across, centred where the twin places it (white ring), from the original file through the camera the build aligned.{state.missing.length ? ` Not on this device: ${state.missing.join(", ")}.` : ""}</p>
      </>}
    </section>
  );
}
