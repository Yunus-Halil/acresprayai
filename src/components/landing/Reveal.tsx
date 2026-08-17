import { useEffect, useRef, type ReactNode } from "react";

/**
 * Rises a block into view the first time it is scrolled to.
 *
 * The trigger is a negative bottom margin rather than a visibility threshold:
 * a section taller than the viewport can never reach "12% of me is visible",
 * so a threshold would leave the tallest sections - the ones with the product
 * screenshots - stuck at opacity 0 forever.
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("sw-in");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return ref;
}

export const Reveal = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`sw-reveal ${className}`}>
      {children}
    </div>
  );
};
