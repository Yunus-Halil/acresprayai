// One crop of an original photograph, cut from its atlas, with the object's outline drawn over it.
import { useEffect, useState } from "react";
import type { TwinEvidence } from "@/lib/fieldTwin/types";

type Props = { evidence: TwinEvidence; atlasUrl: (index: number) => Promise<string>; colour: string; caption: string; px?: number };

export default function EvidenceCrop({ evidence: e, atlasUrl, colour, caption, px = 192 }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null); setError(null);
    atlasUrl(e.atlas).then(u => { if (live) setUrl(u); }).catch(err => { if (live) setError(String(err?.message ?? err)); });
    return () => { live = false; };
  }, [e.atlas, atlasUrl]);
  const k = px / e.size;
  return (
    <figure className="m-0">
      <div className="relative overflow-hidden rounded-sm border border-[#333] bg-[#111]" style={{ width: px, height: px }}>
        {url && (
          <img src={url} alt={`Crop of ${e.photo}`} draggable={false}
            style={{ position: "absolute", left: -e.x * k, top: -e.y * k, transform: `scale(${k})`, transformOrigin: "0 0", maxWidth: "none" }} />
        )}
        {url && e.poly.length >= 3 && (
          <svg className="absolute inset-0" width={px} height={px} viewBox={`0 0 ${e.size} ${e.size}`} aria-hidden>
            <polygon points={e.poly.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={colour} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {!url && !error && <div className="absolute inset-0 grid place-items-center text-[11px] text-neutral-500">Loading…</div>}
        {error && <div className="absolute inset-0 grid place-items-center p-2 text-center text-[11px] text-red-400">{error}</div>}
      </div>
      <figcaption className="mt-1 text-[11px] text-neutral-400">{caption}</figcaption>
    </figure>
  );
}
