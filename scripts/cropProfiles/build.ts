// Validate every crop profile, compile its run-time file, and emit the JSON Schemas.
//
//   npm run profiles:build            validate, then write crop-profiles/<crop>/runtime/<crop>.runtime.json and
//                                     crop-profiles/schema/*.schema.json
//   npm run profiles:build -- --check validate and compare; exit 1 when a written file would change (for CI)
//
// The zod schemas in src/lib/cropProfiles/schema.ts are the source of truth; the JSON Schema files are generated so
// editors and other tools can validate profile JSON without TypeScript.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod/v4";
import { validateProfile, validateShared } from "../../src/lib/cropProfiles/load";
import { compileRuntime } from "../../src/lib/cropProfiles/runtime";
import { DOCUMENT_SCHEMAS, SHARED_SCHEMAS, CropProfile } from "../../src/lib/cropProfiles/schema";
import { PROFILES_DIR, cropIds, readCrop, readShared, runtimePath } from "./fsProfiles";

const check = process.argv.includes("--check");
let failed = false, stale = 0;

function emit(file: string, content: string) {
  const prev = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (prev === content) return;
  if (check) { console.error(`stale: ${file}`); stale++; return; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${file}`);
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const schemaOf = (s: z.ZodType, title: string) => json({ $schema: "https://json-schema.org/draft/2020-12/schema", title, ...(z.toJSONSchema(s, { unrepresentable: "any", io: "input" }) as object) });

// JSON Schemas: one per document, one for the whole profile, one per shared vocabulary.
for (const [k, s] of Object.entries(DOCUMENT_SCHEMAS)) emit(join(PROFILES_DIR, "schema", `${k}.schema.json`), schemaOf(s, `Crop profile: ${k}`));
emit(join(PROFILES_DIR, "schema", "crop-profile.schema.json"), schemaOf(CropProfile, "Crop profile (all documents)"));
for (const [k, s] of Object.entries(SHARED_SCHEMAS)) emit(join(PROFILES_DIR, "schema", "shared", `${k}.schema.json`), schemaOf(s, `Shared vocabulary: ${k}`));

const sh = validateShared(readShared());
if (!sh.ok || !sh.shared) { console.error(sh.errors.join("\n")); process.exit(1); }

for (const id of cropIds()) {
  const r = validateProfile(readCrop(id), sh.shared);
  for (const w of r.warnings) console.warn(`${id}: warning: ${w}`);
  if (!r.ok || !r.profile) { failed = true; console.error(`${id}: INVALID\n  ${r.errors.join("\n  ")}`); continue; }
  emit(runtimePath(id), json(compileRuntime(r.profile, sh.shared)));
  console.log(`${id}: valid (${r.profile.manifest.status}, v${r.profile.manifest.version}, ${r.profile.references.sources.length} sources)`);
}
if (failed) process.exit(1);
if (check && stale) { console.error(`${stale} generated file(s) out of date: run npm run profiles:build`); process.exit(1); }
