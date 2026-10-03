// Credentials for the developer benchmark, from the environment and nowhere
// else. Nothing under scripts/ is bundled into the app: the service-role key
// and the model key are read here, on a developer's machine, and never
// written to a result file, a report or a log line.
//
//   SUPABASE_URL                 the project URL (VITE_SUPABASE_URL is accepted,
//                                since the root .env already carries it)
//   SUPABASE_SERVICE_ROLE_KEY    read access to every scan; the benchmark only
//                                ever SELECTs and reads storage, plus the one
//                                write the app itself makes (caching the four
//                                reconstruction files beside the archive)
//   ROBOFLOW_API_KEY             the baseline detector; absent means --no-model
//   ROBOFLOW_API_URL             optional, defaults to the hosted endpoint
import { existsSync } from "node:fs";

export type BenchEnv = {
  supabaseUrl: string | null;
  serviceRoleKey: string | null;
  roboflowApiKey: string | null;
  roboflowApiUrl: string;
};

/** Load an env file into process.env (values already in the environment win), then read what the benchmark needs. */
export function readBenchEnv(envFile?: string | null): BenchEnv {
  const file = envFile ?? (existsSync(".env") ? ".env" : null);
  if (file) {
    if (!existsSync(file)) throw new Error(`env file not found: ${file}`);
    process.loadEnvFile(file);
  }
  const get = (k: string) => { const v = process.env[k]; return v && v.trim() ? v.trim() : null; };
  return {
    supabaseUrl: get("SUPABASE_URL") ?? get("VITE_SUPABASE_URL"),
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    roboflowApiKey: get("ROBOFLOW_API_KEY"),
    roboflowApiUrl: get("ROBOFLOW_API_URL") ?? "https://detect.roboflow.com",
  };
}

/** Replace every occurrence of a secret in a message, so an error can be shown. */
export function redact(message: string, secrets: (string | null | undefined)[]): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("***");
  return out;
}
