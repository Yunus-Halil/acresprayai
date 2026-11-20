// The banner on a corn twin built from a late flight (2026-11-19): said once over the map, closable, remembered per
// twin on this device. The flight's stage comes from the build (twin.corn.stage, lateStage.ts); a twin built before
// it has none and shows nothing.
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { TwinCornStage } from "@/lib/fieldTwin/types";

const KEY = (id: string) => `swathwise:twin-late-banner:${id}`;

export function lateFlightText(stage: Pick<TwinCornStage, "looked" | "late">): string {
  return `In ${stage.late} of the ${stage.looked} photographs the corn canopy has closed, so Swardus can't see individual plants or the ground between the rows. Rows and weeds here are unreliable, and plants are not counted where the canopy has closed. For now, use photographs from earlier in the season, before the leaves meet across the rows. Support for later flights is coming in an update.`;
}

export default function LateFlightBanner({ twinId, stage }: { twinId: string; stage: TwinCornStage | null | undefined }) {
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(KEY(twinId)) === "closed"; } catch { return false; } });
  if (!stage || stage.verdict !== "late" || closed) return null;
  const close = () => { setClosed(true); try { localStorage.setItem(KEY(twinId), "closed"); } catch { /* storage blocked */ } };
  return (
    <div role="status" aria-label="Late flight" className="pointer-events-auto flex max-w-[560px] items-start gap-2 rounded-md border border-amber-500/60 bg-[#2a2414]/95 px-3 py-2 text-[11px] leading-snug text-amber-100 shadow-lg">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div><p className="text-xs font-semibold text-amber-200">This looks like a late flight</p><p className="mt-0.5">{lateFlightText(stage)}</p></div>
      <button type="button" onClick={close} aria-label="Close the late-flight notice" className="-mr-1 -mt-0.5 rounded-sm p-0.5 text-amber-300 hover:bg-amber-500/20"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}
