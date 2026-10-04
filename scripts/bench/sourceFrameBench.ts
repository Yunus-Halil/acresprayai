// The Layer 2 benchmark, by scan id.
//
//   npm run bench:frames -- --scan <odm_tasks.id | odm_uuid | uuid prefix> [--out data/bench/<name>]
//                           [--finding <candidate_id | row id>] [--limit N]
//                           [--point lat,lng[,spanM]]... [--no-ortho] [--no-model]
//                           [--model weeds-nxe1w/1] [--confidence 40] [--env-file .env]
//   npm run bench:frames -- --odm <dir> --frames <dir> --point lat,lng   (offline; no credentials)
//
// Environment: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// ROBOFLOW_API_KEY (absent: --no-model is implied), ROBOFLOW_API_URL (optional).
// Reads .env from the working directory when it exists. Developer tooling:
// nothing here is imported by the app, and no key is written anywhere.
//
// Exit code: 0 when at least one finding was cut from an original, 1 when
// none was, 2 on a usage error.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseArgs, parsePoint } from "./cli";
import { readBenchEnv, redact } from "./env";
import { renderReport } from "@/lib/sourceFrames/benchReport";
import { DEFAULT_ROBOFLOW_MODEL, createRoboflowRunner } from "./roboflow";
import { type BenchDeps, type BenchOptions, type DbClient, runBench, writeResults } from "./scanBench";

/** Everything that must never appear in output; filled once the environment is read. */
let secrets: (string | null)[] = [];

const USAGE = `usage: npm run bench:frames -- --scan <odm_tasks.id | odm_uuid | uuid prefix> [--out dir] [--finding id] [--limit N]
                               [--point lat,lng[,spanM]]... [--odm dir] [--frames dir] [--no-ortho] [--no-model]
                               [--model ${DEFAULT_ROBOFLOW_MODEL}] [--confidence 40] [--env-file .env]`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) { console.log(USAGE); return 0; }
  const str = (k: string): string | null => (typeof args[k] === "string" ? (args[k] as string) : null);

  const env = readBenchEnv(str("env-file"));
  secrets = [env.serviceRoleKey, env.roboflowApiKey];
  const scan = str("scan");
  const odmDir = str("odm");
  if (!scan && !odmDir) { console.error(USAGE); return 2; }

  const points = Array.isArray(args.point) ? args.point.map(parsePoint) : [];
  const stamp = new Date().toISOString().slice(0, 10);
  const out = str("out") ?? join("data", "bench", `${(scan ?? "offline").slice(0, 8)}-${stamp}`);
  const opts: BenchOptions = {
    scan, odmDir, framesDir: str("frames"), points, finding: str("finding"),
    limit: str("limit") ? Number(str("limit")) : null, compareOrtho: !args["no-ortho"], out,
  };

  const needsDb = !!scan;
  let client: ReturnType<typeof createClient> | null = null;
  if (needsDb) {
    if (!env.supabaseUrl || !env.serviceRoleKey) {
      console.error("set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment or an --env-file");
      return 2;
    }
    client = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  let model = null;
  if (!args["no-model"]) {
    if (env.roboflowApiKey) {
      model = createRoboflowRunner({
        apiKey: env.roboflowApiKey, model: str("model") ?? DEFAULT_ROBOFLOW_MODEL, endpoint: env.roboflowApiUrl,
        confidence: str("confidence") ? Number(str("confidence")) : undefined,
      });
    } else {
      console.log("ROBOFLOW_API_KEY is not set: running geometry and crops only (as --no-model)");
    }
  }

  const deps: BenchDeps = {
    db: client ? (client as unknown as DbClient) : null,
    storage: client,
    fetchImpl: fetch,
    model,
    log: line => console.log(redact(line, secrets)),
    now: () => new Date().toISOString(),
  };

  const run = await runBench(opts, deps);
  const resultsPath = writeResults(out, run);
  const page = join(out, "index.html");
  writeFileSync(page, renderReport(run));
  console.log(`\n${run.summary.findings} finding${run.summary.findings === 1 ? "" : "s"}: ${Object.entries(run.summary.byStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  console.log(`native detections ${run.summary.nativeDetections} on ${run.summary.nativeWithDetections}; ortho detections ${run.summary.orthoDetections} on ${run.summary.orthoWithDetections} of ${run.summary.orthoScored} scored`);
  for (const n of run.notes) console.log(`note: ${redact(n, secrets)}`);
  console.log(`report ${page}\nrecord ${resultsPath}`);
  const cut = run.findings.filter(r => r.native).length;
  return cut > 0 ? 0 : 1;
}

main().then(code => process.exit(code)).catch(e => {
  console.error(`error: ${redact(String((e as Error)?.message ?? e), secrets)}`);
  process.exit(2);
});
