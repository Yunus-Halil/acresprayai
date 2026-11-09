// The last line before a white screen: any render error in the app lands here, is recorded, and the person gets a
// way out (reload, go home, tell us). A page that broke because Swardus was updated while it was open is told so.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isStaleChunkError, recordClientError } from "@/lib/pilot/errorCapture";
import { openFeedback } from "./FeedbackDialog";

type State = { error: Error | null };

export default class AppErrorBoundary extends Component<{ children: ReactNode; /** Inside the app shell, where the feedback dialog lives. */ withFeedback?: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordClientError(error, `render${info.componentStack ? `: ${info.componentStack.split("\n").find(l => l.trim())?.trim().slice(0, 80) ?? ""}` : ""}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunkError(error.message);
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div role="alert" className="w-full max-w-md space-y-3 rounded-lg border bg-card p-6 text-sm">
          <h1 className="font-display text-xl">{stale ? "Swardus was updated" : "Something went wrong on this page"}</h1>
          <p className="text-muted-foreground">{stale ? "This page was opened before the update. Reload it to continue; your saved Field Twins are not affected." : "Your saved Field Twins are not affected. Reload the page to try again. If it keeps happening, tell us what you were doing."}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="outline" onClick={() => { window.location.href = "/app"; }}>Go to Field Twins</Button>
            {this.props.withFeedback && !stale && <Button variant="ghost" onClick={() => openFeedback("problem", null, { error: error.message.slice(0, 300) })}>Tell us</Button>}
          </div>
        </div>
      </div>
    );
  }
}
