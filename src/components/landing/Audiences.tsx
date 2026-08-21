import { Reveal } from "./Reveal";
import { AUDIENCES } from "./copy";

export const Audiences = () => (
  <Reveal className="relative mx-auto max-w-[1200px] px-5 pt-24 sm:px-10 sm:pt-[130px]">
    <section id="who">
      <div className="font-plex text-xs tracking-[0.1em] text-sw-green">WHO IT'S FOR</div>
      <h2 className="m-0 mt-4 max-w-[700px] text-[clamp(30px,5vw,48px)] font-semibold tracking-[-0.03em] text-sw-ink sm:mt-[18px]">
        Built for the field. Ready for the fleet.
      </h2>

      <div className="mt-10 grid gap-8 sm:mt-14 sm:gap-10 md:grid-cols-3">
        {AUDIENCES.map((audience) => (
          <div
            key={audience.label}
            className="rounded-md border border-sw-line bg-sw-card p-6 sm:p-7"
          >
            <div className="font-plex text-xs tracking-[0.1em] text-sw-green">
              {audience.label}
            </div>
            <h3 className="m-0 mb-2.5 mt-3.5 text-xl font-semibold text-sw-ink">
              {audience.title}
            </h3>
            <p className="m-0 text-[15px] leading-[1.55] text-sw-muted">{audience.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-7 font-plex text-xs leading-relaxed text-sw-muted">
        YOUR FIELDS, YOUR DATA. IMAGERY AND ANALYSIS STAY IN YOUR ACCOUNT.
      </p>
    </section>
  </Reveal>
);
