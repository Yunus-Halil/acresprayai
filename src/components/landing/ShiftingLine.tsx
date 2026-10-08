import { useEffect, useState } from "react";

/** How long each phrase holds before the next one slides up into its place. */
export const SHIFT_HOLD_MS = 2600;

/**
 * The second line of the headline, cycling through what the imagery becomes.
 *
 * One phrase at a time, each sliding up into place as the last slides out
 * above it, the way a departures board turns. The box is sized to the longest
 * phrase so the line never reflows, and the phrases are laid out invisibly
 * underneath for that. With reduced motion the first phrase stands still.
 */
export const ShiftingLine = ({ phrases, className = "" }: { phrases: string[]; className?: string }) => {
  const [index, setIndex] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { setStill(true); return; }
    const id = window.setInterval(() => setIndex(i => (i + 1) % phrases.length), SHIFT_HOLD_MS);
    return () => window.clearInterval(id);
  }, [phrases.length]);

  const current = phrases[index];
  const previous = phrases[(index + phrases.length - 1) % phrases.length];

  return (
    <span className={`relative inline-grid overflow-hidden align-top ${className}`} aria-live="polite" aria-atomic="true">
      {/* Every phrase stacked in the same cell so the cell is as wide and tall as the longest. */}
      {phrases.map(p => (
        <span key={p} aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-nowrap">{p}</span>
      ))}
      {!still && index > 0 && (
        <span key={`out-${index}`} aria-hidden="true" className="sw-shift-out col-start-1 row-start-1 whitespace-nowrap">{previous}</span>
      )}
      <span key={`in-${index}`} className={`col-start-1 row-start-1 whitespace-nowrap ${still ? "" : "sw-shift-in"}`}>{current}</span>
    </span>
  );
};
