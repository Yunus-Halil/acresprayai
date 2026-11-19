// The founder's switch for the FINAL-3 corn preset (lib/fieldTwin/cornFinal3Flag.ts): shown to the founder only,
// off until switched on, remembered on this device. Nothing for anyone else.
import { setCornFinal3Switch, useCornPreset } from "@/lib/fieldTwin/cornFinal3Flag";

export function CornFinal3Switch({ className = "" }: { className?: string }) {
  const { offered, on, preset } = useCornPreset();
  if (!offered) return null;
  return (
    <label className={`flex items-start gap-2 text-sm ${className}`} data-testid="corn-final3-switch">
      <input type="checkbox" className="mt-1" checked={on} onChange={e => setCornFinal3Switch(e.target.checked)} />
      <span>Corn preset FINAL-3 (founder, this device)
        <span className="block text-xs text-muted-foreground">{preset === "final3" ? "On: vivid cores, the spacing option for the stricter marks, the emergence guard with the misread rule, no lone-mark sweep. Plant counts are withheld past emergence." : "Off: corn is read as the app reads it for everyone."}</span>
      </span>
    </label>
  );
}
