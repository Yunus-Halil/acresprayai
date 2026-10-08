import { RAIL } from "./copy";

/**
 * The rail: one row of frames from the film, edge to edge, each with a small
 * label in its corner. It scrolls sideways and snaps card to card. The frames
 * are the hero film's own (public/film, cut from the same master), so the
 * rail is the film laid out as stills, with the mission picture at the end.
 * No card is a link: there is nowhere to go yet, and a visitor who wants in
 * asks for access.
 */
export const CardRail = () => (
  <section aria-label="Scenes from the field" className="bg-sw-paper pt-1.5">
    <ul className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1.5 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {RAIL.map(card => (
        <li
          key={card.src}
          className="relative aspect-[16/9] w-[78vw] shrink-0 snap-start overflow-hidden bg-sw-panel sm:w-[420px]"
        >
          <img
            src={card.src}
            alt={card.alt}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute left-2 top-2 max-w-[75%] bg-sw-panel/85 px-2 py-1.5 text-sw-paper backdrop-blur-sm">
            <div className="font-plex text-[9px] tracking-[0.14em] text-sw-bright-hi">{card.eyebrow}</div>
            <div className="mt-0.5 text-[12px] leading-[1.25]">{card.title}</div>
          </div>
        </li>
      ))}
    </ul>
  </section>
);
