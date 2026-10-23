// Which crop profile a field uses: the one entry point from a crop name to its run-time profile.
//
// Only the compiled run-time files are bundled (crop-profiles/<crop>/runtime/<crop>.runtime.json, built by
// npm run profiles:build); the detailed research documents never reach the app. A crop with no profile resolves to
// null and every caller keeps its crop-neutral behaviour, which is how fields of crops not yet profiled stay exactly
// as they were.
import type { RuntimeCropProfile } from "./runtime";

const files = import.meta.glob("../../../crop-profiles/*/runtime/*.runtime.json", { eager: true, import: "default" }) as Record<string, RuntimeCropProfile>;

const PROFILES: RuntimeCropProfile[] = Object.values(files).sort((a, b) => a.id.localeCompare(b.id));

/** Lower case, Turkish dotted and dotless i folded, accents kept apart from the base letter removed, spaces squeezed. */
export function normaliseCropName(s: string | null | undefined): string {
  return (s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim();
}

const ALIAS_INDEX: Map<string, RuntimeCropProfile> = (() => {
  const m = new Map<string, RuntimeCropProfile>();
  for (const p of PROFILES) for (const a of [p.id, p.name, ...p.aliases]) m.set(normaliseCropName(a), p);
  return m;
})();

/**
 * The profile for a field's crop setting, or null. Exact alias match first, then a whole-word match (so "Corn" and
 * "grain corn (Pioneer P1197)" find corn but "peppercorn" and "cornflower" do not).
 */
export function cropProfileFor(crop: string | null | undefined): RuntimeCropProfile | null {
  const c = normaliseCropName(crop);
  if (!c) return null;
  const exact = ALIAS_INDEX.get(c);
  if (exact) return exact;
  const words = c.split(/[^a-z0-9]+/).filter(Boolean);
  for (const [alias, p] of ALIAS_INDEX) {
    const aw = alias.split(/[^a-z0-9]+/).filter(Boolean);
    if (!aw.length) continue;
    for (let i = 0; i + aw.length <= words.length; i++) if (aw.every((w, j) => words[i + j] === w)) return p;
  }
  return null;
}

/** Every profile the app knows, by id. */
export function listCropProfiles(): RuntimeCropProfile[] { return [...PROFILES]; }

export function cropProfileById(id: string): RuntimeCropProfile | null { return PROFILES.find(p => p.id === id) ?? null; }
