import logo from "@/assets/swathwise-logo.png";

/**
 * The swath mark plus the name. The mark is a single boustrophedon pass -
 * the same shape the flight planner draws - so it reads as the product rather
 * than as decoration.
 */
export const Wordmark = ({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) => (
  <span className={`flex items-center gap-2.5 ${className}`}>
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      className={size === "sm" ? "h-5 w-5" : "h-7 w-7"}
    />
    <span
      className={
        size === "sm"
          ? "font-semibold tracking-[-0.02em] text-sw-ink"
          : "text-[22px] font-bold tracking-[-0.02em] text-sw-ink"
      }
    >
      SwathWise
    </span>
  </span>
);
