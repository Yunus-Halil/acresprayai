import RealisticField3D from "@/components/app/RealisticField3D";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, MapPin, Wind, Thermometer, Droplets } from "lucide-react";

export default function FieldView() {
  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Live Field 3D</h1>
          <p className="text-muted-foreground">
            Photoreal terrain reconstruction with a real-time drone overlay and switchable agronomic heatmaps - NDVI, moisture, pest pressure and yield estimate.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Sparkles className="h-3 w-3 text-primary" /> Demo simulation
        </Badge>
      </header>

      <RealisticField3D height={680} />

      <div className="grid md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Field</div>
          <div className="font-display text-lg">B-04 North Quadrant</div>
          <div className="text-xs text-muted-foreground">14.2 ha · Winter Wheat · GS-39</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3" /> NDVI mean</div>
          <div className="font-display text-lg text-emerald-500">0.71</div>
          <div className="text-xs text-muted-foreground">+0.04 vs 7 days · 91% canopy</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Droplets className="h-3 w-3" /> Soil moisture</div>
          <div className="font-display text-lg">28%</div>
          <div className="text-xs text-muted-foreground">Dry pocket on SE slope</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Wind className="h-3 w-3" /> Wind / temp</div>
          <div className="font-display text-lg">4.8 m/s · 22°C</div>
          <div className="text-xs text-muted-foreground">Spray window: 06:00-09:30</div>
        </Card>
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Heatmaps are GPU-rasterized from simulated agronomic indices. Connect a real flight via the Mission Planner to replace these with measured tiles.
      </p>
    </div>
  );
}