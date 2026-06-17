import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  label?: string;
  detail?: string;
};

/**
 * Inline notice that the data on screen is sample/preview data, not real
 * telemetry. Use anywhere DEMO_* fixtures are rendered.
 */
export const DemoBadge = ({
  className,
  label = "Preview data",
  detail = "Sample values shown for demonstration - not live measurements.",
}: Props) => {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-dashed border-accent/50 bg-accent/10 px-3 py-2 text-xs",
        className,
      )}
      role="note"
      aria-label="Preview data notice"
    >
      <Info className="h-3.5 w-3.5 mt-0.5 text-accent-foreground/80 shrink-0" />
      <div className="leading-snug">
        <span className="font-mono uppercase tracking-wider text-[10px] text-accent-foreground/90">
          {label}
        </span>
        <span className="ml-2 text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
};
