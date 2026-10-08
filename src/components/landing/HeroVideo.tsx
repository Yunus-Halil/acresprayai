import { useEffect, useRef, useState } from "react";

/**
 * The full-bleed clip behind the hero: real flights, the field, the route and
 * the map, muted and looping, under the page's own rule for moving pictures
 * (see SimVideo): never a mock-up, never a render.
 *
 * It sits above the fold, so it cannot wait to scroll into view the way the
 * cockpit clip does; what it does instead is choose how much to ask for.
 * Nothing moves for anyone who asked for reduced motion or whose browser
 * reports a slow or metered connection: they get the poster, which is a real
 * frame and carries the picture on its own. A narrow screen gets the 1280
 * encode, a wide one the 1920. Either way the poster paints first and the
 * clip fades in over it once it can play.
 */
export const HeroVideo = ({ className = "" }: { className?: string }) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const frugal = conn?.saveData === true
      || (conn?.effectiveType ? /^(slow-)?2g$/.test(conn.effectiveType) : false);
    if (reduced || frugal) return;
    setSrc(window.innerWidth < 900 ? "/video/hero-1280.mp4" : "/video/hero.mp4");
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    el.play().catch(() => { /* autoplay refused; the poster stands */ });
  }, [src]);

  return (
    <div className={`absolute inset-0 overflow-hidden bg-sw-panel ${className}`} aria-hidden="true">
      <img
        src="/video/hero-poster.jpg"
        alt=""
        decoding="async"
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {src && (
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="auto"
          poster="/video/hero-poster.jpg"
          onPlaying={() => setPlaying(true)}
          onError={() => setSrc(null)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing ? "opacity-100" : "opacity-0"}`}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}
    </div>
  );
};
