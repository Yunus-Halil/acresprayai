import mark from "@/assets/swardus-mark.png";

/**
 * The mark plus the name. The mark is white on nothing (swardus-mark.png is
 * the X with the octagon at its heart, transparent), so it sits on whatever
 * is behind it. With `glass` it sits in a frosted pill: a translucent,
 * blurred surface that takes its colour from what is behind it, so over the
 * hero film the mark reads against the film rather than on a box. On paper
 * (tone "ink") the mark is drawn in difference blend, which turns white into
 * ink over a light surface without a second asset.
 */
export const Wordmark = ({
  size = "md",
  tone = "ink",
  glass = false,
  className = "",
}: {
  size?: "sm" | "md";
  /** Ink on paper, or paper on a dark surface such as the hero film. */
  tone?: "ink" | "paper";
  /** A frosted-glass pill behind the mark and the name. */
  glass?: boolean;
  className?: string;
}) => (
  <span
    className={`inline-flex items-center gap-2.5 ${glass ? "sw-glass rounded-full py-1.5 pl-2.5 pr-4" : ""} ${className}`}
    data-glass={glass ? "true" : undefined}
  >
    <img
      src={mark}
      alt=""
      aria-hidden="true"
      className={`${size === "sm" ? "h-5 w-5" : "h-7 w-7"} ${tone === "ink" ? "mix-blend-difference" : ""}`}
    />
    <span
      className={
        size === "sm"
          ? `font-semibold tracking-[-0.02em] ${tone === "paper" ? "text-white" : "text-sw-ink"}`
          : `text-[22px] font-bold tracking-[-0.02em] ${tone === "paper" ? "text-white" : "text-sw-ink"}`
      }
    >
      Swardus
    </span>
  </span>
);
