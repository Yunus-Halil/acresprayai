import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight } from "lucide-react";

type Field = {
  id: string;
  name: string;
  area_hectares: number | null;
  boundary: unknown | null;
  boundary_area_hectares: number | null;
};

const HA_TO_AC = 2.4710538147;

function healthTone(score: number | null) {
  if (score == null) return { dot: "bg-muted-foreground/40", text: "text-muted-foreground", label: "—" };
  if (score >= 70) return { dot: "bg-emerald-500", text: "text-emerald-500", label: `${score}` };
  if (score >= 40) return { dot: "bg-amber-500", text: "text-amber-500", label: `${score}` };
  return { dot: "bg-red-500", text: "text-red-500", label: `${score}` };
}

// ----------------------------------------------------------------------------
export default function Dashboard() {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const f = await supabase
        .from("fields")
        .select("id, name, area_hectares, boundary, boundary_area_hectares")
        .order("created_at", { ascending: false });
      setFields((f.data as Field[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const realArea = (f: Field) => Number(f.boundary_area_hectares ?? f.area_hectares ?? 0);
  const definedCount = fields.filter(f => f.boundary).length;
  const totalAreaHa = useMemo(
    () => fields.reduce((a, f) => a + realArea(f), 0),
    [fields],
  );

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Operations Dashboard</h1>
          <p className="text-muted-foreground text-sm">A snapshot of your fields and scans.</p>
        </div>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Total fields</div>
          <div className="font-display text-4xl mt-1 tabular-nums">{fields.length}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {definedCount} with mapped boundary · {fields.length - definedCount} undefined
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Total area</div>
          <div className="font-display text-4xl mt-1 tabular-nums">{totalAreaHa.toFixed(1)}<span className="text-base text-muted-foreground ml-1">ha</span></div>
          <div className="text-xs text-muted-foreground mt-1 tabular-nums">{(totalAreaHa * HA_TO_AC).toFixed(1)} acres</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Boundaries defined</div>
          <div className="font-display text-4xl mt-1 tabular-nums">{definedCount}<span className="text-base text-muted-foreground ml-1">/ {fields.length || 0}</span></div>
          <div className="text-xs text-muted-foreground mt-1">Draw the field outline in the orthomosaic viewer to unlock AI analysis.</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Field list */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Fields</h2>
            <Link to="/app/fields" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
              Manage <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields yet. <Link to="/app/fields" className="underline">Create your first field</Link>.</p>
          ) : (
            <ul className="divide-y divide-border">
              {fields.map(f => {
                const defined = !!f.boundary;
                const tone = healthTone(null);
                const area = realArea(f);
                return (
                  <li key={f.id}>
                    <Link to={`/app/fields/${f.id}`} className="flex items-center gap-3 py-3 hover:bg-muted/30 rounded-md px-2 -mx-2 transition-colors">
                      <span className={`h-2.5 w-2.5 rounded-full ${defined ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-sm">{f.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {area ? `${area.toFixed(2)} ha · ${(area * HA_TO_AC).toFixed(2)} ac` : "—"}
                          {defined && <span className="ml-2 text-emerald-500">(measured)</span>}
                        </div>
                      </div>
                      <Badge variant="outline" className={defined ? "border-emerald-500 text-emerald-500" : "text-muted-foreground"}>
                        {defined ? "Boundary set" : "Not defined"}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}