import { useEffect, useRef, useState } from "react";

const TILE = 72; // matches the ink grid drawn behind the hero
const MAX_ALIVE = 8;
const SPAWN_MS = 700;
const LIFE_MS = 2400;
const FADE_MS = 1600;

type Tile = { id: number; col: number; row: number; opacity: number; lit: boolean };

/**
 * Random tiles of the hero's background grid glow green and fade out again.
 *
 * Purely decorative, so it is aria-hidden, it stops while the tab is hidden,
 * and it renders nothing at all under prefers-reduced-motion.
 */
export const TileGrid = () => {
  const host = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const [tiles, setTiles] = useState<Tile[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    const spawn = setInterval(() => {
      const el = host.current;
      if (!el || document.hidden) return;

      const columns = Math.floor(el.offsetWidth / TILE);
      if (columns < 1) return;

      const id = nextId.current++;
      const tile: Tile = {
        id,
        col: Math.floor(Math.random() * columns),
        row: Math.floor(Math.random() * 12),
        opacity: 0.05 + Math.random() * 0.09,
        lit: false,
      };

      setTiles((current) => (current.length >= MAX_ALIVE ? current : [...current, tile]));
      // Mount transparent, then light up, so the CSS transition has something
      // to interpolate from.
      timers.push(
        setTimeout(() => setTiles((c) => c.map((t) => (t.id === id ? { ...t, lit: true } : t))), 30),
        setTimeout(() => setTiles((c) => c.map((t) => (t.id === id ? { ...t, lit: false } : t))), LIFE_MS),
        setTimeout(() => setTiles((c) => c.filter((t) => t.id !== id)), LIFE_MS + FADE_MS + 200),
      );
    }, SPAWN_MS);

    return () => {
      clearInterval(spawn);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-[900px] overflow-hidden"
    >
      {tiles.map((t) => (
        <div
          key={t.id}
          className="absolute bg-sw-bright transition-opacity duration-[1600ms] ease-linear"
          style={{
            left: t.col * TILE + 1,
            top: t.row * TILE + 1,
            width: TILE - 1,
            height: TILE - 1,
            opacity: t.lit ? t.opacity : 0,
          }}
        />
      ))}
    </div>
  );
};
