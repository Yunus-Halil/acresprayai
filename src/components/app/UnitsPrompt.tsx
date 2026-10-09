import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { UnitSystem } from "@/lib/units";

/**
 * Asked once, at first sign-in, before any number is shown.
 *
 * Not dismissible: a person who closes it without choosing would see imperial
 * by default and might never learn that metric was a choice. Two buttons and
 * nothing else, and the field Settings tab and the sidebar can change it later.
 */
export function UnitsPrompt({ open, initial, onChoose }: {
  open: boolean;
  initial: UnitSystem;
  onChoose: (sys: UnitSystem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const choose = (sys: UnitSystem) => { setBusy(true); onChoose(sys); };
  const btn = (sys: UnitSystem, title: string, detail: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => choose(sys)}
      className={`rounded-md border p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60 ${
        initial === sys ? "border-primary" : "border-border"}`}
    >
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </button>
  );
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onEscapeKeyDown={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Which units do you work in?</DialogTitle>
          <DialogDescription>
            Every area, volume, rate, distance, speed and temperature in Swardus will use
            this, on every device you sign in from. You can change it later from the sidebar
            or any field's Settings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {btn("imperial", "Imperial", "acres, gallons, gal/ac, feet, mph, °F")}
          {btn("metric", "Metric", "hectares, liters, L/ha, meters, km/h, °C")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
