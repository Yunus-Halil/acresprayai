import { useEffect, useRef, useState } from "react";
import { Label } from "./Cta";
import { EvidencePhoto } from "./EvidencePhoto";
import { Reveal } from "./Reveal";
import { BEYOND } from "./copy";
import { SPECIMEN } from "./specimen";
import { useReducedMotion } from "./useReducedMotion";

/**
 * "Beyond the map": the visitor scrolls from the whole field down to one weed and its photographs.
 *
 * The pictures are the Field Twin's own renderer over the real apricot flight (scripts/site/captureTwin.mjs):
 * 40 frames of one continuous zoom, plus the same view with the weed selected. Scrolling scrubs through them on
 * a canvas with a crossfade between neighbouring frames, so the detail appears exactly as it does in the app.
 * A portrait set serves tall screens. No animation library: one scroll listener, throttled to the display.
 *
 * Reduced motion gets the same story as four stills and the photographs, with no scrubbing.
 */
const FRAMES = 40;
/** Share of the scroll spent on the zoom; the rest is the selection and the photographs. */
const ZOOM_END = 0.78;
const SELECT_AT = 0.8;
const PHOTOS_AT = BEYOND.stages[4].from;

type FrameSet = "desktop" | "mobile";
const frameUrl = (set: FrameSet, i: number) => `/site/twin/${set}/f-${String(i).padStart(2, "0")}.webp`;
const selUrl = (set: FrameSet) => `/site/twin/${set}/sel.webp`;
const pickSet = (): FrameSet => (window.innerWidth / window.innerHeight < 0.9 ? "mobile" : "desktop");
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, alpha: number) {
  if (!img.complete || !img.naturalWidth) return false;
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
  return true;
}

const stageAt = (p: number) => {
  let k = 0;
  BEYOND.stages.forEach((s, i) => { if (p >= s.from) k = i; });
  return k;
};

const StageList = ({ active }: { active: number }) => (
  <ol className="m-0 list-none p-0">
    {BEYOND.stages.map((s, i) => (
      <li key={s.label} className={`flex items-baseline gap-4 py-1.5 transition-colors duration-300 ${i === active ? "text-sw-ivory" : "text-sw-ivory/35"}`}>
        <Label className="w-6 shrink-0">{String(i + 1).padStart(2, "0")}</Label>
        <span className="text-[15px] tracking-[-0.01em]">{s.label}</span>
      </li>
    ))}
  </ol>
);

const Photos = ({ lazy = true }: { lazy?: boolean }) => (
  <div>
    <Label className="text-sw-ivory/60">{BEYOND.photosLabel}</Label>
    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {SPECIMEN.photos.map((_, i) => <EvidencePhoto key={i} index={i} lazy={lazy} />)}
    </div>
  </div>
);

function Scrub() {
  const track = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const photos = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const frames = useRef<HTMLImageElement[]>([]);
  const sel = useRef<HTMLImageElement | null>(null);
  const progress = useRef(0);
  const [set, setSet] = useState<FrameSet>("desktop");
  const [stage, setStage] = useState(0);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => { setSet(pickSet()); }, []);

  useEffect(() => {
    const el = track.current, cv = canvas.current;
    if (!el || !cv) return;
    let raf = 0, loaded = false;

    const draw = () => {
      raf = 0;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const p = progress.current;
      const w = cv.width, h = cv.height;
      const f = clamp01(p / ZOOM_END) * (FRAMES - 1);
      const i0 = Math.floor(f), i1 = Math.min(FRAMES - 1, i0 + 1), t = f - i0;
      ctx.fillStyle = "#292f27";
      ctx.fillRect(0, 0, w, h);
      let ok = false;
      const a = frames.current[i0], b = frames.current[i1];
      if (a) ok = drawCover(ctx, a, w, h, 1);
      if (b && t > 0.01) drawCover(ctx, b, w, h, t);
      const sa = clamp01((p - SELECT_AT) / 0.04);
      if (sel.current && sa > 0) drawCover(ctx, sel.current, w, h, sa);
      if (ok) setDrawn(true);
      const pa = clamp01((p - PHOTOS_AT) / 0.05);
      if (photos.current) {
        photos.current.style.opacity = String(pa);
        photos.current.style.transform = `translateY(${(1 - pa) * 16}px)`;
        photos.current.style.pointerEvents = pa > 0.5 ? "auto" : "none";
      }
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      setStage(prev => { const k = stageAt(p); return k === prev ? prev : k; });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(cv.clientWidth * dpr);
      cv.height = Math.round(cv.clientHeight * dpr);
      schedule();
    };
    const measure = () => {
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      progress.current = span > 0 ? clamp01(-r.top / span) : 0;
      schedule();
    };
    const load = () => {
      if (loaded) return;
      loaded = true;
      const list: HTMLImageElement[] = [];
      for (let i = 0; i < FRAMES; i++) {
        const img = new Image();
        img.decoding = "async";
        img.onload = schedule;
        img.src = frameUrl(set, i);
        list.push(img);
      }
      frames.current = list;
      const s = new Image();
      s.onload = schedule;
      s.src = selUrl(set);
      sel.current = s;
    };

    // Fetch the frames only as the section approaches: about 2 MB the visitor may never scroll to.
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { load(); io.disconnect(); } }, { rootMargin: "120% 0px" });
    io.observe(el);
    const onResize = () => {
      const want = pickSet();
      if (want !== set) setSet(want);
      size();
      measure();
    };
    size();
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [set]);

  const current = BEYOND.stages[stage];
  return (
    <div ref={track} className="relative h-[480svh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden bg-[#292f27]">
        {!drawn && <img src={frameUrl(set, 0)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <canvas
          ref={canvas}
          role="img"
          aria-label="The Field Twin of an apricot orchard, zooming from the whole field down to a single weed"
          className="absolute inset-0 h-full w-full"
        />

        <div className="pointer-events-none absolute inset-0 mx-auto flex max-w-[1440px] flex-col justify-between px-5 pb-8 pt-24 sm:px-10 sm:pb-10 sm:pt-28 lg:px-16 lg:pb-14">
          <div className="max-w-[420px] bg-sw-night/85 p-5 sm:p-6">
            <Label className="text-sw-sage">{String(stage + 1).padStart(2, "0")} / {String(BEYOND.stages.length).padStart(2, "0")} · {current.label}</Label>
            <p key={current.label} className="sw-load m-0 mt-3 text-[clamp(22px,2.4vw,32px)] leading-[1.15] tracking-[-0.025em] text-sw-ivory">
              {current.line}
            </p>
            <div className="mt-5 hidden md:block"><StageList active={stage} /></div>
          </div>

          <div className="flex justify-end">
            <div ref={photos} className="w-full bg-sw-night/90 p-3 opacity-0 sm:p-4 md:w-[min(720px,58vw)]">
              <Photos />
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-px bg-sw-ivory/10">
          <div ref={bar} className="h-full origin-left bg-sw-ivory/70" style={{ transform: "scaleX(0)" }} />
        </div>
      </div>
    </div>
  );
}

/** Reduced motion: the same four moments as stills, then the photographs. */
function Stills() {
  const shots = [
    { src: frameUrl("desktop", 0), stage: 0 },
    { src: frameUrl("desktop", 12), stage: 1 },
    { src: frameUrl("desktop", 30), stage: 2 },
    { src: selUrl("desktop"), stage: 3 },
  ];
  return (
    <div className="mx-auto max-w-[1440px] px-5 pb-[clamp(80px,10vw,160px)] sm:px-10 lg:px-16">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {shots.map(s => (
          <figure key={s.src} className="m-0">
            <img src={s.src} alt={BEYOND.stages[s.stage].line} loading="lazy" className="block aspect-[16/10] w-full object-cover" />
            <figcaption className="mt-3 flex gap-4 text-sw-ivory/80">
              <Label className="text-sw-sage">{BEYOND.stages[s.stage].label}</Label>
              <span className="text-[15px]">{BEYOND.stages[s.stage].line}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-12"><Photos /></div>
    </div>
  );
}

export const BeyondTheMap = () => {
  const reduced = useReducedMotion();
  return (
    <section id="beyond" className="relative bg-sw-night text-sw-ivory">
      <div className="mx-auto max-w-[1440px] px-5 pb-12 pt-[clamp(96px,12vw,180px)] sm:px-10 sm:pb-16 lg:px-16">
        <Reveal>
          <Label className="text-sw-ivory/50">{BEYOND.caption}</Label>
          <h2 className="m-0 mt-5 font-geist text-[clamp(44px,7vw,112px)] font-medium leading-[0.95] tracking-[-0.045em]">{BEYOND.heading}</h2>
        </Reveal>
      </div>
      {reduced ? <Stills /> : <Scrub />}
    </section>
  );
};
