// The one entry point to AI analysis that cannot be missed.
//
// WHY IT EXISTS. Three entry points already ran the same analysis, and all
// three could be invisible on a fresh field:
//
//   - Field View's lives inside a drawer that starts COLLAPSED, behind the
//     label "Field Health: Not analyzed" — which describes a result, not an
//     action, and so reads as a status line rather than a thing to press.
//   - The AI Analysis tab is not in the default tab set; it has to be opened
//     from the "+" menu first.
//   - The Flight Planner tab is not either, and its button only appears in an
//     empty state.
//
// So anyone opening a field they had not analyzed saw no way to analyze it.
// This lives in the top bar, which renders on every tab whatever any drawer is
// doing, and it leads with a verb. The other three are deliberately left in
// place — the goal is one entry point that is impossible to miss, not the
// removal of ones that already work.
//
// It is a separate component mainly so that contract can be tested without
// booting the entire workspace shell.
import { Loader2, Sparkles } from "lucide-react";

export function AnalyzeFieldButton({
  hasAnalysis, analyzing, onRun, className = "",
}: {
  /** Whether a result already exists — changes the wording, never the presence. */
  hasAnalysis: boolean;
  analyzing: boolean;
  onRun: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={analyzing}
      // Named for what pressing it DOES. The label a user scans for is the
      // verb, which is exactly what the "Field Health" strip lacked.
      aria-label={hasAnalysis ? "Re-analyze field" : "Analyze field"}
      aria-busy={analyzing}
      title={hasAnalysis
        ? "Run AI analysis again over this orthomosaic"
        : "Detect bare patches, waterlogging and row gaps, and draw treatment zones"}
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-sm text-xs font-semibold transition-colors ${
        analyzing
          ? "bg-[#161616] border border-[#222] text-neutral-400 cursor-wait"
          : hasAnalysis
            // Once a result exists the button stops competing with it for
            // attention, but it stays exactly where it was — re-running has to
            // be as findable as running was.
            ? "bg-[#161616] border border-[#222] text-neutral-300 hover:text-[#f0f0f0] hover:border-[#333]"
            : "bg-[#4CAF50] hover:bg-[#43a047] text-black"
      } ${className}`}
    >
      {analyzing
        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
        : <><Sparkles className="h-3.5 w-3.5" /> {hasAnalysis ? "Re-analyze" : "Analyze Field"}</>}
    </button>
  );
}

export default AnalyzeFieldButton;
