import { useEffect, useRef, useState } from "react";

/**
 * The simulation running, as a looping silent clip.
 *
 * A real screen capture of the product, under the same rule as the
 * screenshots: never a mock-up, never a render (see public/screens/README.md).
 *
 * AUTOPLAY IS CONDITIONAL, and that is deliberate. This product is aimed at
 * growers on rural connections, so a 1.1 MB clip is not something to push at
 * everyone unasked. It loads and plays when it actually scrolls into view, it
 * does not load at all for anyone who has asked for reduced motion or is on a
 * connection the browser reports as slow, and the poster frame carries the
 * whole story on its own — the frame chosen shows tank dynamics, the transport
 * and the full telemetry panel, so a viewer who never sees a moving pixel
 * still sees the product.
 */
export const SimVideo = ({
  poster, sources, label, className = "",
}: {
  poster: string;
  sources: { src: string; type: string }[];
  label: string;
  className?: string;
}) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    // `saveData` and `effectiveType` are non-standard but widely shipped; the
    // optional chain means a browser without them simply plays.
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const frugal = conn?.saveData === true
      || (conn?.effectiveType ? /^(slow-)?2g$/.test(conn.effectiveType) : false);
    if (reduced || frugal) return;

    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive(true);
            el.play().catch(() => { /* autoplay refused; poster stands */ });
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (failed) {
    return (
      <img
        src={poster}
        alt={label}
        loading="lazy"
        decoding="async"
        className={`block rounded ${className}`}
      />
    );
  }

  return (
    <video
      ref={ref}
      poster={poster}
      muted
      loop
      playsInline
      // Nothing downloads until it is on screen and allowed.
      preload={active ? "auto" : "none"}
      controls={false}
      aria-label={label}
      onError={() => setFailed(true)}
      className={`block rounded ${className}`}
    >
      {active && sources.map(s => <source key={s.src} src={s.src} type={s.type} />)}
      {label}
    </video>
  );
};
