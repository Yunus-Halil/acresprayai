import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Bug, Leaf, Droplets, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Field = { id: string; name: string; crop: string };
type Detection = {
  type: string; label: string; severity: "low" | "medium" | "high";
  coverage_pct?: number; recommendation?: string;
};
type Result = {
  health_score: number;
  summary?: string;
  detections: Detection[];
  likely_issues: string[];
  crop_type?: string;
};

export default function Analyzer() {
  const { user } = useAuth();
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldId, setFieldId] = useState("");
  const [cropType, setCropType] = useState("Wheat");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    supabase.from("fields").select("id, name, crop").then(({ data }) => setFields((data as Field[]) ?? []));
  }, []);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const analyze = async () => {
    if (!file) { toast.error("Upload an image first"); return; }
    setLoading(true);
    setResult(null);
    try {
      const path = `${user!.id}/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("scans").upload(path, file);
      if (up.error) throw up.error;
      const imageDataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const field = fields.find(f => f.id === fieldId);
      const { data, error } = await supabase.functions.invoke("analyze-scan", {
        body: { imageUrl: imageDataUrl, cropType, fieldName: field?.name },
      });
      if (error) throw error;
      if ((data as any).error) throw new Error((data as any).error);
      const a = data as any;
      const r: Result = {
        health_score: a.health_score ?? 0,
        summary: a.summary,
        detections: Array.isArray(a.detections) ? a.detections.slice(0, 8) : [],
        likely_issues: Array.isArray(a.likely_issues) ? a.likely_issues.slice(0, 6).map(String) : [],
        crop_type: a.crop_type,
      };
      setResult(r);
      await supabase.from("scans").insert({
        user_id: user!.id,
        field_id: fieldId || null,
        image_path: up.data?.path ?? path,
        status: "completed",
        health_score: r.health_score,
        detections: { detections: r.detections } as any,
        ai_summary: r.summary ?? null,
      });
      toast.success("AI analysis complete");
    } catch (e: any) {
      toast.error(e.message ?? "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const sevColor = (s: string) =>
    s === "high" ? "border-destructive text-destructive" :
    s === "medium" ? "border-amber-500 text-amber-600" :
    "border-emerald-500 text-emerald-600";
  const Icon = (t: string) => t === "pest" ? Bug : t === "weed" ? Leaf : t === "disease" ? Droplets : Sparkles;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl">AI Crop Analyzer</h1>
        <p className="text-muted-foreground">Upload an aerial image of one of your fields. AcreSpray AI inspects it and saves the result to your records.</p>
      </header>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <Card className="overflow-hidden">
          <div className="relative aspect-[4/3] bg-muted flex items-center justify-center">
            {previewUrl ? (
              <img src={previewUrl} alt="Drone capture" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="text-sm text-muted-foreground text-center p-8">
                Upload an aerial image of your field to begin.
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5 space-y-3">
            <div>
              <Label className="text-xs">Field (optional)</Label>
              <Select value={fieldId} onValueChange={setFieldId}>
                <SelectTrigger><SelectValue placeholder={fields.length ? "Select field" : "No fields yet"} /></SelectTrigger>
                <SelectContent>
                  {fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Crop</Label>
              <Input value={cropType} onChange={e => setCropType(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Image</Label>
              <Input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button className="w-full" size="lg" onClick={analyze} disabled={loading || !file}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? "Analyzing…" : "Run AI analysis"}
            </Button>
          </Card>

          {result && (
            <>
              <Card className="p-5">
                <div className="flex items-center gap-4 mb-3">
                  <div className="font-display text-4xl">{result.health_score}</div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Field health index</div>
                    <div className="font-display text-base flex items-center gap-2">
                      {result.health_score >= 75 ? <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Healthy</>
                        : result.health_score >= 50 ? <><AlertTriangle className="h-4 w-4 text-amber-500" /> Stressed</>
                        : <><AlertTriangle className="h-4 w-4 text-destructive" /> Critical</>}
                    </div>
                  </div>
                </div>
                {result.summary && <p className="text-sm leading-relaxed text-muted-foreground">{result.summary}</p>}
              </Card>

              {result.detections.length > 0 && (
                <Card className="p-5 space-y-2">
                  <h3 className="font-display">Detections</h3>
                  {result.detections.map((d, i) => {
                    const I = Icon(d.type);
                    return (
                      <div key={i} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 font-medium text-sm">
                            <I className="h-3.5 w-3.5" /> {d.label}
                          </div>
                          <Badge variant="outline" className={sevColor(d.severity)}>{d.severity}</Badge>
                        </div>
                        {d.recommendation && <div className="text-xs mt-1">{d.recommendation}</div>}
                      </div>
                    );
                  })}
                </Card>
              )}

              {result.likely_issues.length > 0 && (
                <Card className="p-5 space-y-2">
                  <h3 className="font-display flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Likely issues</h3>
                  <ul className="space-y-2">
                    {result.likely_issues.map((t, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}