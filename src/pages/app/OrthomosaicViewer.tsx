import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Loader2 } from "lucide-react";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

export default function OrthomosaicViewer() {
  const { taskId } = useParams<{ taskId: string }>();
  const [odmUuid, setOdmUuid] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { setErr("Please sign in."); return; }
      setToken(s.session.access_token);
      const { data, error } = await supabase.from("odm_tasks")
        .select("odm_uuid").eq("id", taskId).maybeSingle();
      if (error || !data?.odm_uuid) { setErr("Scan not found"); return; }
      setOdmUuid(data.odm_uuid);
    })();
  }, [taskId]);

  if (err) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 text-sm">
        <div className="text-destructive">{err}</div>
        <a href="/app/fields" className="text-primary underline">Back to fields</a>
      </div>
    );
  }
  if (!odmUuid || !token) {
    return (
      <div className="h-screen flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading orthomosaic…
      </div>
    );
  }

  const tileUrl = `${FN_BASE}/odm-asset?uuid=${odmUuid}&token=${encodeURIComponent(token)}&tile={z}/{x}/{y}`;

  return (
    <div className="h-screen w-screen relative">
      <button
        type="button"
        onClick={() => window.history.back()}
        className="absolute top-3 left-3 z-[1000] bg-background/90 backdrop-blur px-3 py-1.5 rounded-md border text-sm inline-flex items-center gap-1 shadow"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>
      <MapContainer center={[0, 0]} zoom={2} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <TileLayer url={tileUrl} opacity={0.95} maxNativeZoom={22} maxZoom={24} />
      </MapContainer>
    </div>
  );
}