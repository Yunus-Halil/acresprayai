import lockupWhite from "@/assets/brand/lockup-white.png";
import lockupInk from "@/assets/brand/lockup-ink.png";

/** Width over height of the lockup picture, so the glass variant can size itself from its height alone. */
const LOCKUP_ASPECT = "1283 / 323";

/**
 * The lockup as the designer drew it: the mark and the name in one picture,
 * on nothing (src/assets/brand, cut from the originals in brand/source). Ink
 * on paper, or white on a dark surface such as the hero film.
 *
 * With `glass` the glyph and the letters ARE the glass: the lockup is a CSS
 * mask over a frosted backdrop (index.css .sw-glass-mark), so each shape is a
 * blurred, lightened window onto whatever is behind it, and there is nothing
 * around them. Where a browser has no backdrop filter, the mask still shows
 * the lockup in translucent white.
 */
export const Wordmark = ({
  size = "md",
  tone = "ink",
  glass = false,
  className = "",
}: {
  size?: "sm" | "md";
  tone?: "ink" | "paper";
  glass?: boolean;
  className?: string;
}) => {
  const height = size === "sm" ? "h-6" : "h-9 sm:h-11";
  if (glass) {
    const mask = `url(${lockupWhite})`;
    return (
      <span
        role="img"
        aria-label="Swardus"
        data-glass="true"
        className={`sw-glass-mark inline-block ${height} ${className}`}
        style={{ aspectRatio: LOCKUP_ASPECT, WebkitMaskImage: mask, maskImage: mask }}
      />
    );
  }
  return (
    <span className={`inline-flex items-center ${className}`}>
      <img src={tone === "paper" ? lockupWhite : lockupInk} alt="Swardus" className={`${height} w-auto`} />
    </span>
  );
};
