import { SPECIMEN } from "./specimen";

/**
 * One crop of an original photograph with the weed's outline as the detector drew it in that photograph. The
 * picture is the photograph (scripts/site/plantPhotos.py); the outline is an SVG over it, never painted in.
 */
export const EvidencePhoto = ({ index, className = "", lazy = true }: { index: number; className?: string; lazy?: boolean }) => {
  const p = SPECIMEN.photos[index];
  const n = SPECIMEN.cropPx;
  return (
    <div className={`relative aspect-square overflow-hidden bg-sw-coal ${className}`}>
      <img src={p.src} alt="" loading={lazy ? "lazy" : "eager"} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      <svg viewBox={`0 0 ${n} ${n}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
        <polygon
          points={p.poly.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="#e8b26a"
          strokeWidth={1.4}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
};
