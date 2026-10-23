// Reading crop profiles from disk (Node only): the shared vocabularies and each crop folder's documents, by manifest.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_DOCUMENTS } from "../../src/lib/cropProfiles/schema";

export const PROFILES_DIR = "crop-profiles";

const readJson = (f: string): unknown => JSON.parse(readFileSync(f, "utf8"));

export const SHARED_FILES = {
  units: "shared/units.json",
  growthStageSystems: "shared/growth-stage-systems.json",
  plantingPatternTypes: "shared/planting-pattern-types.json",
  morphologyVocabulary: "shared/morphology-vocabulary.json",
  imageQualityStandards: "shared/image-quality-standards.json",
  uncertaintyCodes: "shared/uncertainty-codes.json",
  weedTaxonomy: "shared/weed-taxonomy/species.json",
} as const;

export function readShared(root = PROFILES_DIR): Record<keyof typeof SHARED_FILES, unknown> {
  return Object.fromEntries(Object.entries(SHARED_FILES).map(([k, f]) => [k, readJson(join(root, f))])) as Record<keyof typeof SHARED_FILES, unknown>;
}

/** Crop folders: every directory with a manifest.json, except schema and shared. */
export function cropIds(root = PROFILES_DIR): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && !["schema", "shared"].includes(e.name) && existsSync(join(root, e.name, "manifest.json")))
    .map(e => e.name).sort();
}

/** One crop's documents, by the manifest's file list. A missing file is reported by the validator, not thrown here. */
export function readCrop(id: string, root = PROFILES_DIR): Record<string, unknown> {
  const dir = join(root, id);
  const manifest = readJson(join(dir, "manifest.json")) as { files?: Record<string, string> };
  const out: Record<string, unknown> = { manifest };
  for (const d of PROFILE_DOCUMENTS) {
    const f = manifest.files?.[d];
    out[d] = f && existsSync(join(dir, f)) ? readJson(join(dir, f)) : undefined;
  }
  return out;
}

export const runtimePath = (id: string, root = PROFILES_DIR) => join(root, id, "runtime", `${id}.runtime.json`);
