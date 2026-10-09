// A tab that throws while rendering must not take the whole page with it.
//
// React unmounts the entire tree on an uncaught render error, which the
// operator sees as a white screen with no words on it. This catches the error
// at the tab, says what it was in plain text (the message is the one thing
// that lets anyone fix it), and offers to draw the tab again. Nothing here
// touches the run: the scout's session lives outside the component
// (weedScout/runStore.ts), so a redraw picks up where the run is.
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] render failed`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-6 space-y-3 text-sm" role="alert" data-testid="tab-error">
        <div className="font-medium text-neutral-100">{this.props.name} could not be drawn.</div>
        <pre className="whitespace-pre-wrap break-words rounded-sm border border-[#333] bg-[#121212] p-3 text-[11px] text-red-300">{error.message || String(error)}</pre>
        <p className="text-neutral-400">Whatever was running is still running. Copy the text above when you report this.</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="rounded-sm border border-[#333] px-3 py-1.5 text-neutral-200 hover:bg-[#1f1f1f]">
          Draw it again
        </button>
      </div>
    );
  }
}
