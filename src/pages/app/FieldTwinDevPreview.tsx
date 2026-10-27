// Development only: the Field Twin viewer over a twin built on this computer, served by the dev server's
// /__field-twin route, with no sign-in. Exists so the screenshot and benchmark script (scripts/directGeoref/
// twinShots.mjs) can open the real apricot twin. Never part of a production build (App.tsx mounts it under
// import.meta.env.DEV only), and it never shows reference imagery (that needs the account's session).
import { useEffect, useState } from "react";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import { type TwinBundle, parseTwin } from "@/lib/fieldTwin/types";

export default function FieldTwinDevPreview() {
  const [twin, setTwin] = useState<TwinBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = new URLSearchParams(window.location.search).get("id") ?? "";
  useEffect(() => {
    (async () => {
      try {
        const list = (await (await fetch("/__field-twin/")).json()) as string[];
        const pick = id || list[0];
        if (!pick) throw new Error("no twin under data/direct-georef/twin/");
        const parsed = parseTwin(await (await fetch(`/__field-twin/${pick}/twin.json`)).json());
        if ("reason" in parsed) throw new Error(parsed.reason);
        setTwin(parsed.twin);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [id]);
  if (error) return <div className="p-6 text-sm text-red-400">{error}</div>;
  if (!twin) return <div className="p-6 text-sm text-neutral-400">Loading the twin…</div>;
  return (
    <div className="h-screen w-screen bg-[#1a1c1a]">
      <FieldTwinView twin={twin} atlasUrl={async i => `/__field-twin/${twin.id}/${twin.atlases[i].file}`} expose />
    </div>
  );
}
