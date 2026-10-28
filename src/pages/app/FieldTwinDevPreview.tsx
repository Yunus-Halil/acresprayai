// Development only: the Field Twin viewer over a twin built on this computer, served by the dev server's
// /__field-twin route, with no sign-in. Exists so the screenshot and benchmark script (scripts/directGeoref/
// twinShots.mjs) can open the real apricot twin, and ?synthetic=N builds a generated field of N observations. Never part of a production build (App.tsx mounts it under
// import.meta.env.DEV only), and it never shows reference imagery (that needs the account's session).
import { useEffect, useState } from "react";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import TwinBuilder, { type BuiltTwin } from "@/components/app/fieldTwin/TwinBuilder";
import { syntheticTwin } from "@/lib/fieldTwin/synthetic";
import { type TwinBundle, parseTwin } from "@/lib/fieldTwin/types";

export default function FieldTwinDevPreview() {
  const [twin, setTwin] = useState<TwinBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuiltTwin | null>(null);
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id") ?? "";
  // ?build=1: the builder panel instead of a twin from disk (the build benchmark script, and a look without a sign-in).
  const build = params.get("build") === "1";
  // ?synthetic=100000: a generated field of that many observations, for the benchmark script (never a real field).
  const synthetic = Number(params.get("synthetic") ?? 0);
  // ?detail=simple|standard|full: the dial's stop to open at (the screenshot script), else the remembered one.
  const detailParam = params.get("detail");
  const detail = detailParam === "simple" || detailParam === "standard" || detailParam === "full" ? detailParam : undefined;
  useEffect(() => {
    if (build) return;
    (async () => {
      try {
        if (synthetic > 0) { setTwin(syntheticTwin({ weeds: synthetic })); return; }
        const list = (await (await fetch("/__field-twin/")).json()) as string[];
        const pick = id || list[0];
        if (!pick) throw new Error("no twin under data/direct-georef/twin/");
        // Phase marks for scripts/directGeoref/twinOpenBench.mjs: bytes, JSON.parse, the bundle checks.
        performance.mark("twin:fetch:start");
        const text = await (await fetch(`/__field-twin/${pick}/twin.json`)).text();
        performance.mark("twin:fetch:end"); performance.measure("twin:fetch", "twin:fetch:start", "twin:fetch:end");
        const json = JSON.parse(text) as unknown;
        performance.mark("twin:json:end"); performance.measure("twin:json", "twin:fetch:end", "twin:json:end");
        const parsed = parseTwin(json);
        performance.mark("twin:parse:end"); performance.measure("twin:parse", "twin:json:end", "twin:parse:end");
        if ("reason" in parsed) throw new Error(parsed.reason);
        setTwin(parsed.twin);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [id, synthetic, build]);
  if (error) return <div className="p-6 text-sm text-red-400">{error}</div>;
  if (build && !twin) {
    return (
      <div className="h-screen w-screen bg-[#1a1c1a]">
        <aside className="absolute right-3 top-3 bottom-3 z-[800] w-[420px] rounded-md border border-[#343834] bg-[#171a17]" aria-label="Twin builder">
          <TwinBuilder expose onBuilt={b => { setBuilt(b); setTwin(b.twin); }} onClose={() => undefined} />
        </aside>
      </div>
    );
  }
  if (!twin) return <div className="p-6 text-sm text-neutral-400">Loading the twin…</div>;
  const atlasUrl = built
    ? async (i: number) => { const file = twin.atlases[i].file; let b = built.files.get(file); if (!b) { await built.atlases; b = built.files.get(file); } if (!b) throw new Error(`${file} missing`); return URL.createObjectURL(b); }
    : async (i: number) => `/__field-twin/${twin.id}/${twin.atlases[i].file}`;
  return (
    <div className="h-screen w-screen bg-[#1a1c1a]">
      <FieldTwinView twin={twin} atlasUrl={atlasUrl} expose detail={detail} />
    </div>
  );
}
