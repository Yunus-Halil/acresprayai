import { useEffect, useRef, useState } from "react";
import { HERO_MEDIA, type HeroClip } from "./heroMedia";

/**
 * The full-bleed footage behind the hero, played from the list in heroMedia.ts.
 *
 * It sits above the fold, so it chooses how much to ask for instead of waiting: nothing moves for anyone who
 * asked for reduced motion or whose browser reports a data saver or a 2G link; they get the first clip's
 * poster, a real frame that carries the picture alone. A narrow screen gets the 1280 encode. The poster
 * paints first and the clip fades in over it once it plays. Off screen, the clip pauses.
 */
export const HeroVideo = ({ media = HERO_MEDIA, className = "" }: { media?: HeroClip[]; className?: string }) => {
  const box = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [motion, setMotion] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clip = media[index % media.length];
  const src = clip ? (narrow && clip.srcSmall ? clip.srcSmall : clip.src) : null;

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const frugal = conn?.saveData === true || (conn?.effectiveType ? /^(slow-)?2g$/.test(conn.effectiveType) : false);
    setNarrow(window.innerWidth < 900);
    setMotion(!reduced && !frugal);
  }, []);

  // Play while on screen, pause when scrolled away: the footage costs nothing once the visitor has moved on.
  useEffect(() => {
    const el = box.current;
    if (!el || !motion) return;
    const io = new IntersectionObserver(([e]) => {
      const v = video.current;
      if (!v) return;
      if (e.isIntersecting) v.play().catch(() => { /* autoplay refused; the poster stands */ });
      else v.pause();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [motion, index]);

  if (!clip) return <div className={`absolute inset-0 bg-sw-night ${className}`} aria-hidden="true" />;

  return (
    <div ref={box} className={`absolute inset-0 overflow-hidden bg-sw-night ${className}`} aria-hidden="true">
      {/* fetchpriority in lower case: this React version does not know the camel-case prop. */}
      <img src={clip.poster} alt="" decoding="async" {...{ fetchpriority: "high" }} className="absolute inset-0 h-full w-full object-cover" />
      {motion && src && (
        <video
          key={src}
          ref={video}
          muted
          autoPlay
          loop={media.length === 1}
          playsInline
          preload="auto"
          poster={clip.poster}
          onPlaying={() => setPlaying(true)}
          onEnded={() => { setPlaying(false); setIndex(i => (i + 1) % media.length); }}
          onError={() => setMotion(false)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing ? "opacity-100" : "opacity-0"}`}
          style={clip.zoom ? { transform: `scale(${clip.zoom})` } : undefined}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}
    </div>
  );
};
