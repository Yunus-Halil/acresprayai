// Step 1 on the field page: the flight that has not been flown yet.
//
// Collapsed to a single button until a plan exists, because a field that has
// never been surveyed should not be met with a form. Once one exists the card
// states what it is and offers the two things anyone comes back for: change it,
// or get the file again.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, MapPin, Plane, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import type { LatLng2 } from "@/lib/geo";
import { fmtAltitude, fmtDistance } from "@/lib/units";
import {
  LOW_ALTITUDE_M, generateKmz, isLowAltitude, kmzFilename, lowAltitudeCaution, resolveFlightPlan,
} from "@/lib/flightPlan/generateKmz";
import { type FlightPlan, listFlightPlans, markExported } from "@/lib/flightPlan/repo";
import FlightPlanModal from "./FlightPlanModal";

export default function FlightPlanCard({
  fieldId, fieldName, fieldBoundary,
}: {
  fieldId: string;
  fieldName: string;
  fieldBoundary: LatLng2[][] | null;
}) {
  const units = useUnitSystem();
  const [plans, setPlans] = useState<FlightPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FlightPlan | null>(null);
  const [showAll, setShowAll] = useState(false);
  // A saved plan is re-exported straight from this card, without the modal
  // ever opening, so the low-altitude confirmation has to live here too. A
  // warning that only appears on the screen where the plan was written is no
  // warning at all the second time somebody flies it.
  const [confirming, setConfirming] = useState<FlightPlan | null>(null);

  const load = useCallback(() => {
    listFlightPlans(fieldId)
      .then(rows => { setPlans(rows); setLoadError(null); })
      // A failed load must not render as "no plans yet": someone who has a
      // saved plan would read that as their work being gone.
      .catch(e => { setPlans(null); setLoadError((e as Error)?.message ?? "Could not load flight plans."); });
  }, [fieldId]);
  useEffect(() => { load(); }, [load]);

  const latest = plans?.[0] ?? null;

  const exportOrConfirm = (plan: FlightPlan) => {
    if (isLowAltitude(plan.params.altitudeM)) { setConfirming(plan); return; }
    reExport(plan);
  };

  const reExport = (plan: FlightPlan) => {
    try {
      const { pkg } = generateKmz(plan.boundary, plan.params, { createTimeMs: Date.now() });
      const url = URL.createObjectURL(pkg.kmz);
      const a = document.createElement("a");
      a.href = url;
      a.download = kmzFilename(fieldName, new Date());
      a.click();
      URL.revokeObjectURL(url);
      void markExported(plan.id);
      load();
      toast.success("Flight plan downloaded.");
    } catch (e) {
      toast.error("Couldn't build the flight file", { description: (e as Error)?.message });
    }
  };

  const summarise = (plan: FlightPlan) => {
    const r = resolveFlightPlan(plan.boundary, plan.params);
    return {
      lines: r.grid.lineCount,
      photos: r.stats.photoCount,
      spacing: fmtDistance(r.computed.lineSpacingM, units).text,
      altitude: fmtAltitude(plan.params.altitudeM, units).text,
      blocker: r.blocker,
      lowAltitude: r.lowAltitude,
    };
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Step 1</div>
          <h2 className="font-display text-xl">Create flight plan</h2>
          <p className="text-sm text-muted-foreground">
            Plan the survey flight over <strong>{fieldName}</strong>, download it as a DJI KMZ, and fly it.
            The photographs come back here in step 2.
          </p>
        </div>
        {latest && (
          <Button size="sm" variant="outline" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> New plan
          </Button>
        )}
      </div>

      {loadError && (
        <div className="text-sm text-destructive">
          Couldn&rsquo;t load saved flight plans ({loadError}). This is a loading failure, not an empty list.{" "}
          <button className="underline" onClick={load}>Retry</button>
        </div>
      )}

      {plans === null && !loadError && (
        <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      )}

      {plans?.length === 0 && (
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plane className="h-4 w-4" /> Create flight plan
        </Button>
      )}

      {latest && (
        <div className="space-y-2">
          {(showAll ? plans! : [latest]).map(plan => {
            const s = summarise(plan);
            return (
              <div key={plan.id} className="rounded border p-3 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="text-sm">
                    <div className="font-medium">
                      {plan.name || `${s.lines} line${s.lines === 1 ? "" : "s"}, ${s.photos} photo${s.photos === 1 ? "" : "s"}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.spacing} spacing at {s.altitude}
                      {" · "}{plan.params.frontOverlapPct}% front, {plan.params.sideOverlapPct}% side
                      {" · "}saved {new Date(plan.createdAt).toLocaleDateString()}
                      {plan.lastExportedAt
                        ? ` · last exported ${new Date(plan.lastExportedAt).toLocaleDateString()}`
                        : " · never exported"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(plan); setOpen(true); }}>Edit</Button>
                    <Button size="sm" variant="outline" disabled={!!s.blocker} onClick={() => exportOrConfirm(plan)}>
                      Re-export KMZ
                    </Button>
                  </div>
                </div>
                {s.lowAltitude && (
                  <div className="text-xs text-destructive inline-flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>Low altitude. Re-exporting asks you to confirm.</span>
                  </div>
                )}
                {s.blocker && <div className="text-xs text-amber-700 dark:text-amber-500">{s.blocker}</div>}
              </div>
            );
          })}

          {plans!.length > 1 && (
            <button className="text-xs underline text-muted-foreground" onClick={() => setShowAll(v => !v)}>
              {showAll ? "Show only the most recent" : `Show all ${plans!.length} plans`}
            </button>
          )}
          <p className="text-[11px] text-muted-foreground inline-flex items-start gap-1.5">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            Copy the KMZ to the remote, then open it from the aircraft&rsquo;s waypoint list.
          </p>
        </div>
      )}

      <FlightPlanModal
        open={open}
        onOpenChange={setOpen}
        fieldId={fieldId}
        fieldName={fieldName}
        fieldBoundary={fieldBoundary}
        existing={editing}
        onSaved={load}
      />

      <AlertDialog open={confirming !== null} onOpenChange={o => { if (!o) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Fly at {confirming ? fmtAltitude(confirming.params.altitudeM, units).text : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && lowAltitudeCaution(
                fmtAltitude(confirming.params.altitudeM, units).text,
                fmtAltitude(LOW_ALTITUDE_M, units).text,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const plan = confirming;
              setConfirming(null);
              if (plan) reExport(plan);
            }}>
              I have checked the route, download it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
