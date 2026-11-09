// A participant's Field Twin, read-only, for troubleshooting. The server opens it only while the participant allows
// troubleshooting access, and logs the opening (with the reason typed here) where the participant can see it.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pilotAdmin } from "@/lib/pilot/adminClient";
import { gunzipText } from "@/lib/fieldTwin/store";
import { type TwinBundle, parseTwin } from "@/lib/fieldTwin/types";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";

type Opened = { twin: { id: string; name: string; user_id: string }; files: Record<string, string> };

export default function AdminTwinViewer() {
  const { id = "" } = useParams();
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ status: "ask" } | { status: "opening" } | { status: "error"; message: string } | { status: "open"; twin: TwinBundle; name: string; files: Record<string, string> }>({ status: "ask" });
  const urls = useRef(new Map<string, Promise<string>>());
  useEffect(() => () => { for (const p of urls.current.values()) void p.then(u => URL.revokeObjectURL(u)).catch(() => undefined); }, []);

  const openIt = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "opening" });
    try {
      const o = await pilotAdmin<Opened>("twin-open", { twin_id: id, reason: reason.trim() || null });
      const gz = o.files["twin.json.gz"];
      const res = await fetch(gz ?? o.files["twin.json"]);
      if (!res.ok) throw new Error(`the twin's file could not be downloaded (${res.status})`);
      const text = gz ? await gunzipText(await res.blob()) : await res.text();
      const parsed = parseTwin(JSON.parse(text));
      if ("reason" in parsed) throw new Error(parsed.reason);
      setState({ status: "open", twin: parsed.twin, name: o.twin.name, files: o.files });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  };

  const atlasUrl = useCallback((index: number): Promise<string> => {
    if (state.status !== "open") return Promise.reject(new Error("not open"));
    const file = state.twin.atlases[index]?.file;
    const signed = file ? state.files[file] : undefined;
    if (!file || !signed) return Promise.reject(new Error(`no atlas ${index}`));
    let p = urls.current.get(file);
    if (!p) { p = fetch(signed).then(r => { if (!r.ok) throw new Error(`atlas ${index}: ${r.status}`); return r.blob(); }).then(b => URL.createObjectURL(b)); urls.current.set(file, p); }
    return p;
  }, [state]);

  const back = <Link to="/admin/pilot?tab=twins" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />Field Twins</Link>;
  if (state.status !== "open") {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 sm:p-10">
        <Seo title="Open a participant's Field Twin, Swardus" noindex />
        {back}
        <h1 className="font-display text-2xl">Open a participant's Field Twin</h1>
        <p className="text-sm text-muted-foreground">This shows their field and crops of their photographs. It works only if they allowed troubleshooting access, and the opening is logged where they can see it, with your reason.</p>
        <form onSubmit={openIt} className="space-y-3">
          <div><label htmlFor="reason" className="text-sm font-medium">Why are you opening it?</label><Input id="reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="For example: their feedback says the weeds near the gate are wrong" required /></div>
          <Button type="submit" disabled={state.status === "opening" || !reason.trim()}>{state.status === "opening" && <Loader2 className="h-4 w-4 animate-spin" />}Open read-only</Button>
        </form>
        {state.status === "error" && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{state.message}</p>}
      </div>
    );
  }
  return (
    <div className="flex h-[100dvh] flex-col bg-[#0f0f0f] text-neutral-200">
      <Seo title={`${state.name} (read-only), Swardus`} noindex />
      <header className="flex flex-wrap items-center gap-3 border-b border-[#262626] bg-[#121212] px-3 py-1.5 text-sm">
        <Link to="/admin/pilot?tab=twins" className="inline-flex items-center gap-1 text-xs text-neutral-300 hover:text-neutral-100"><ArrowLeft className="h-3.5 w-3.5" />Admin</Link>
        <h1 className="font-display text-base">{state.name}</h1>
        <span className="text-[11px] text-amber-300">Read-only, opened for troubleshooting. Your reviews are not added to theirs.</span>
      </header>
      <main className="relative min-h-0 flex-1"><FieldTwinView twin={state.twin} atlasUrl={atlasUrl} audience="founder" /></main>
    </div>
  );
}
