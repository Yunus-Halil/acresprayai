import { useState } from "react";
import { Label } from "./Cta";
import { Reveal } from "./Reveal";
import { OPERATIONS } from "./copy";

/**
 * "From finding to field operation": the scout's findings, the treatment zone and the mission, as three frames
 * on one line, numbered in order. Each picture is a capture of the app (public/screens, re-encoded to WebP in
 * public/site/ops). A missing picture shows its description in the frame instead of a broken image.
 */
const Frame = ({ src, alt, position }: { src: string; alt: string; position: string }) => {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-sw-coal-2">
      {failed ? (
        <p className="absolute inset-0 m-0 grid place-items-center p-6 text-center text-sm text-sw-ivory/50">{alt}</p>
      ) : (
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: position }} />
      )}
    </div>
  );
};

export const Operations = () => (
  <section id="operations" className="bg-sw-coal text-sw-ivory">
    <div className="mx-auto max-w-[1440px] px-5 py-[clamp(96px,12vw,180px)] sm:px-10 lg:px-16">
      <Reveal>
        <h2 className="m-0 max-w-[14ch] font-geist text-[clamp(44px,7vw,112px)] font-medium leading-[0.95] tracking-[-0.045em]">{OPERATIONS.heading}</h2>
      </Reveal>

      <ol className="m-0 mt-16 grid list-none gap-12 p-0 sm:mt-24 md:grid-cols-3 md:gap-6">
        {OPERATIONS.steps.map((s, i) => (
          <li key={s.label}>
            <Reveal>
              <div className="flex items-center gap-4 border-t border-sw-ivory/20 pt-4">
                <Label className="text-sw-sage">{String(i + 1).padStart(2, "0")}</Label>
                <span className="text-[17px] tracking-[-0.01em]">{s.label}</span>
              </div>
              <div className="mt-5"><Frame src={s.src} alt={s.alt} position={s.position} /></div>
              <p className="m-0 mt-5 max-w-[34ch] text-[16px] leading-[1.45] text-sw-ivory/70">{s.line}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </div>
  </section>
);
