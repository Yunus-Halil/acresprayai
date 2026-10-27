/**
 * The hero's footage, in the order it plays. This list is the only thing to edit to change it.
 *
 * - One clip loops. Several play one after another and the last hands back to the first; each crossfades
 *   over its own poster, so a slow connection sees a still frame, never black.
 * - `src` is the wide encode (1920), `srcSmall` the narrow one (1280) for screens under 900 px. Both are
 *   muted H.264 MP4 with no audio track; encode commands are in public/video/README.md.
 * - `poster` is a real frame of that clip. It is all a visitor sees with reduced motion or a data saver on.
 * - `zoom` (optional, 1 to 1.2) scales the clip up inside the frame to crop black bars baked into the source.
 * - Real flights only: never stock, a render or a mock-up (copy.ts, rule 10).
 */
export type HeroClip = { src: string; srcSmall?: string; poster: string; zoom?: number };

export const HERO_MEDIA: HeroClip[] = [
  // Seconds 9, 10 and 17 of this cut are an app screen recording with black bars down both sides (about 4.3 %
  // of the width each); 1.1 crops them off and costs the drone footage a sliver at its edges.
  { src: "/video/hero.mp4", srcSmall: "/video/hero-1280.mp4", poster: "/video/hero-poster.jpg", zoom: 1.1 },
];
