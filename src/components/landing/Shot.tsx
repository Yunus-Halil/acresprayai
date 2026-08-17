import { useState, type ReactNode } from "react";

type ScreenshotProps = {
  /** Path under public/screens. See public/screens/README.md. */
  src: string;
  alt: string;
  className?: string;
};

/**
 * A real product screenshot.
 *
 * Every image on this page is a genuine capture of the app - never stock,
 * never a mock-up. If one is missing from the build we say so in the frame
 * rather than showing a browser's broken-image glyph or collapsing the row.
 */
export const Screenshot = ({ src, alt, className = "" }: ScreenshotProps) => {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <div
        className={`flex min-h-[220px] items-center justify-center rounded border border-dashed border-white/15 px-6 py-10 text-center font-plex text-[11px] leading-relaxed tracking-[0.08em] text-sw-on-dark-faint ${className}`}
      >
        {alt.toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setMissing(true)}
      className={`block rounded ${className}`}
    />
  );
};

type FrameProps = {
  caption?: string;
  /** Right-hand side of the caption bar, e.g. a green "● SPRAYING" status. */
  status?: ReactNode;
  className?: string;
  padding?: string;
  children: ReactNode;
};

/** The dark instrument frame the screenshots sit in. */
export const Frame = ({
  caption,
  status,
  className = "",
  padding = "p-2",
  children,
}: FrameProps) => (
  <div className={`rounded-lg bg-sw-panel ${padding} ${className}`}>
    {caption && (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2.5 pb-3 pt-1.5 font-plex text-[10px] tracking-[0.08em] text-sw-on-dark-faint sm:text-[11px]">
        <span>{caption}</span>
        {status}
      </div>
    )}
    {children}
  </div>
);

/** The common case: one screenshot in one frame. */
export const Shot = ({
  src,
  alt,
  caption,
  status,
  className = "",
  imgClassName = "w-full",
  padding,
}: ScreenshotProps & Omit<FrameProps, "children"> & { imgClassName?: string }) => (
  <Frame caption={caption} status={status} className={className} padding={padding}>
    <Screenshot src={src} alt={alt} className={imgClassName} />
  </Frame>
);
