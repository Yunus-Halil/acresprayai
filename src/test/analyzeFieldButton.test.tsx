// The always-visible entry point to AI analysis.
//
// This exists because the feature was already fully built and shipped, and was
// nonetheless unreachable: three buttons ran it, and on a fresh field all three
// were hidden — one inside a collapsed drawer, two inside tabs that are not
// open by default. Nobody who had not read the source could analyze a field.
//
// So what is pinned here is not styling. It is that the control is present,
// that it is a real button, and that it says what pressing it does — the three
// properties whose absence caused the bug.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalyzeFieldButton from "@/components/app/workspace/AnalyzeFieldButton";

describe("a field nobody has analyzed yet", () => {
  it("offers a button that names the action", async () => {
    render(<AnalyzeFieldButton hasAnalysis={false} analyzing={false} onRun={() => {}} />);

    const btn = screen.getByRole("button", { name: /analyze field/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeEnabled();
    // The label a user scans for is the VERB. "Field Health: Not analyzed"
    // describes a result and reads as a status line, which is precisely why
    // the existing entry point went unnoticed.
    expect(btn).toHaveTextContent(/analyze/i);
  });

  it("runs the analysis when pressed", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<AnalyzeFieldButton hasAnalysis={false} analyzing={false} onRun={onRun} />);

    await user.click(screen.getByRole("button", { name: /analyze field/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe("while it is running", () => {
  it("says so, and refuses a second run", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<AnalyzeFieldButton hasAnalysis={false} analyzing onRun={onRun} />);

    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/analyzing/i);
    expect(btn).toHaveAttribute("aria-busy", "true");

    await user.click(btn);
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe("once a result exists", () => {
  it("stays put, offering a re-run rather than disappearing", async () => {
    // The regression this guards: hiding the control after a successful run
    // would recreate the original bug for anyone wanting to analyze again
    // after editing a boundary or flying a newer scan.
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<AnalyzeFieldButton hasAnalysis analyzing={false} onRun={onRun} />);

    const btn = screen.getByRole("button", { name: /re-analyze field/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent(/re-analyze/i);

    await user.click(btn);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("is present in every state, which is the whole point", () => {
    // One assertion over all three states together, because the property that
    // matters is unconditional presence — not what any single state looks like.
    for (const [hasAnalysis, analyzing] of [[false, false], [false, true], [true, false]] as const) {
      const { unmount } = render(
        <AnalyzeFieldButton hasAnalysis={hasAnalysis} analyzing={analyzing} onRun={() => {}} />,
      );
      expect(screen.getByRole("button")).toBeInTheDocument();
      unmount();
    }
  });
});
