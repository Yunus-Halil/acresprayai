// The catalog importer: what it accepts is exactly what the package says,
// and what it refuses is any claim the package does not make.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CatalogImportError, canonicalJson, cyrb53, parseCatalog, reviewQueueId, sourceHashOf, summariseEntries,
} from "@/lib/weedCatalog/import";
import { REVIEW_OWNED_COLUMNS } from "@/lib/weedCatalog/types";

const PKG = join(__dirname, "..", "..", "weeddatabase", "Virginia_weed_catalog_v0.1");
const readJson = (name: string) => JSON.parse(readFileSync(join(PKG, name), "utf8").replace(/^ /, ""));
const loadPackage = () => ({
  catalog: readJson("catalog.json"),
  sources: readJson("sources.json"),
  reviewQueue: readJson("review_queue.json"),
  coverage: readJson("coverage.json"),
});
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe("the Virginia v0.1 package", () => {
  const present = existsSync(join(PKG, "catalog.json"));
  const itIf = present ? it : it.skip;

  itIf("imports with the counts its coverage report declares, and nothing more", () => {
    const pkg = loadPackage();
    const p = parseCatalog(pkg);
    const cover = pkg.coverage as Record<string, number>;
    expect(p.state).toBe("VA");
    expect(p.entries.length).toBe(cover.total_catalog_records);
    expect(p.entries.filter(e => e.crop_evidence.length).length).toBe(cover.crop_context_sourced);
    expect(p.entries.filter(e => e.regulatory_tier).length).toBe(cover.regulatory_list_entries);
    expect(p.entries.filter(e => e.catalog_status === "regulatory_only").length).toBe(cover.law_only_additions);
    expect(p.review_queue.length).toBe(cover.review_queue_items);
    expect(p.sources.map(s => s.source_id).sort()).toEqual(["USDA_VA", "VA_NOXIOUS_2026", "VT_PMG_2026", "VT_WEEDID"]);
  });

  itIf("carries no claim the catalog does not make", () => {
    const p = parseCatalog(loadPackage());
    for (const e of p.entries) {
      expect(e.aerial_identification_validated).toBe(false);
      // Tier 1 = not known present in Virginia; never also a checklist match.
      if (e.regulatory_tier === "Tier 1") expect(e.usda_status).not.toBe("matched");
      expect(e.catalog_status === "crop_context_sourced").toBe(e.crop_evidence.length > 0);
      for (const c of e.crop_contexts) expect(["corn", "soybean", "small_grains", "pasture_hay"]).toContain(c);
    }
    const tier1 = p.entries.filter(e => e.regulatory_tier === "Tier 1");
    expect(tier1.length).toBeGreaterThan(0);
  });

  itIf("never writes a review-owned column", () => {
    const p = parseCatalog(loadPackage());
    for (const e of p.entries) {
      for (const col of REVIEW_OWNED_COLUMNS) expect(col in e).toBe(false);
    }
    for (const q of p.review_queue) {
      expect(q.resolved).toBe(false);
      expect(q.resolution).toBeNull();
    }
  });

  itIf("is repeatable: the same package produces the same ids and hashes", () => {
    const a = parseCatalog(loadPackage());
    const b = parseCatalog(loadPackage());
    expect(a.entries.map(e => [e.catalog_id, e.source_hash])).toEqual(b.entries.map(e => [e.catalog_id, e.source_hash]));
    expect(a.review_queue.map(q => q.id)).toEqual(b.review_queue.map(q => q.id));
    expect(new Set(a.review_queue.map(q => q.id)).size).toBe(a.review_queue.length);
    expect(new Set(a.entries.map(e => e.catalog_id)).size).toBe(a.entries.length);
  });

  itIf("changes exactly one hash when one record's source content changes", () => {
    const pkg = loadPackage();
    const before = parseCatalog(clone(pkg));
    const mutated = clone(pkg) as { catalog: { records: Record<string, unknown>[] } };
    mutated.catalog.records[3].common_name = "renamed upstream";
    const after = parseCatalog(mutated as never);
    const changed = after.entries.filter((e, i) => e.source_hash !== before.entries[i].source_hash);
    expect(changed.length).toBe(1);
    expect(changed[0].common_name).toBe("renamed upstream");
  });

  itIf("summarises from the rows, not from the coverage file", () => {
    const p = parseCatalog(loadPackage());
    const s = summariseEntries(p.entries);
    expect(s.total).toBe(755);
    expect(s.byStatus.crop_context_sourced).toBe(54);
    expect(s.unresolvedUsda).toBe(98);
    expect(s.byTier.map(([t]) => t)).toEqual(["Tier 1", "Tier 2", "Tier 3"]);
  });
});

describe("refusals", () => {
  const base = () => ({
    catalog: {
      catalog_version: "0.1.0", state: "VA", as_of: "2026-09-22", scope: "test", source_ids: ["S1"],
      records: [{
        catalog_id: "T-1", common_name: "test weed", scientific_name_as_source: "Testus weedus",
        plant_type_as_source: "broadleaf", vt_profile_url: null,
        usda_virginia: { status: "matched", candidate_accepted_symbols: ["TEWE"], usda_symbol: "TEWE", match_method: "binomial_candidate", matched_row_count: 1 },
        crop_evidence: [], regulatory: null, catalog_status: "source_index_only",
        aerial_identification_validated: false, source_ids: ["S1"],
        habitat_review_cues: { profile_checked: true, where_found_present: false, automated_flags: [], mentions_virginia: false },
      }],
    },
    sources: { S1: { title: "Source", url: "https://example.org", accessed: "2026-09-22", scope: "test" } },
    reviewQueue: [],
  });
  const problemsOf = (pkg: ReturnType<typeof base>): string[] => {
    try { parseCatalog(pkg as never); return []; } catch (e) { return (e as CatalogImportError).problems; }
  };

  it("accepts the minimal valid package", () => {
    expect(problemsOf(base())).toEqual([]);
  });
  it("refuses a record claiming aerial validation", () => {
    const p = base(); p.catalog.records[0].aerial_identification_validated = true as never;
    expect(problemsOf(p).join("\n")).toMatch(/T-1: aerial_identification_validated must be false/);
  });
  it("refuses Tier 1 with a checklist match", () => {
    const p = base(); p.catalog.records[0].regulatory = { tier: "Tier 1", source_id: "S1", scientific_name_as_law: "Testus weedus" } as never;
    expect(problemsOf(p).join("\n")).toMatch(/Tier 1 must not imply state presence/);
  });
  it("refuses a crop status with no crop evidence, and crop evidence left in index-only status", () => {
    const p = base(); p.catalog.records[0].catalog_status = "crop_context_sourced";
    expect(problemsOf(p).join("\n")).toMatch(/crop_context_sourced with no crop evidence/);
    const q = base(); q.catalog.records[0].crop_evidence = [{ crop: "corn", source_id: "S1", locator: "Table 1" }] as never;
    expect(problemsOf(q).join("\n")).toMatch(/crop evidence left in source-only status/);
  });
  it("refuses duplicate ids and unknown sources", () => {
    const p = base(); p.catalog.records.push(clone(p.catalog.records[0]));
    expect(problemsOf(p).join("\n")).toMatch(/duplicate catalog_id T-1/);
    const q = base(); q.catalog.records[0].source_ids = ["NOPE"];
    expect(problemsOf(q).join("\n")).toMatch(/unknown source NOPE/);
  });
  it("refuses a coverage report that disagrees with the records", () => {
    const p = { ...base(), coverage: { total_catalog_records: 2 } };
    expect(problemsOf(p as never).join("\n")).toMatch(/coverage.total_catalog_records says 2, records say 1/);
  });
  it("refuses a queue item pointing at an unknown entry", () => {
    const p = base(); (p.reviewQueue as unknown[]).push({ label: "x", reason: "y", catalog_id: "T-9" });
    expect(problemsOf(p).join("\n")).toMatch(/unknown T-9/);
  });
});

describe("hashing", () => {
  it("is independent of key order and sensitive to content", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(cyrb53("abc")).toBe(cyrb53("abc"));
    expect(cyrb53("abc")).not.toBe(cyrb53("abd"));
    expect(cyrb53("abc")).toHaveLength(16);
  });
  it("ignores the version stamp", () => {
    const row = {
      catalog_id: "T-1", state: "VA", catalog_version: "0.1.0", as_of: "2026-09-22", common_name: "a", scientific_name_as_source: "b",
      plant_type: "broadleaf", vt_profile_url: null, usda_status: "matched" as const, usda_symbol: null, usda_candidate_symbols: [],
      usda_match_method: null, crop_evidence: [], crop_contexts: [], regulatory_tier: null, regulatory_scientific_name: null,
      regulatory_source_id: null, catalog_status: "source_index_only" as const, aerial_identification_validated: false, source_ids: ["S1"],
      habitat_flags: [], habitat_profile_checked: false, habitat_where_found_present: false, habitat_mentions_state: false,
    };
    expect(sourceHashOf(row)).toBe(sourceHashOf({ ...row, catalog_version: "0.2.0", as_of: "2027-01-01" }));
    expect(sourceHashOf(row)).not.toBe(sourceHashOf({ ...row, common_name: "z" }));
  });
  it("gives a queue item an id from what it is about", () => {
    expect(reviewQueueId("VA", { label: "pigweed", source_id: "S" })).toBe(reviewQueueId("VA", { label: "pigweed", source_id: "S" }));
    expect(reviewQueueId("VA", { label: "pigweed", source_id: "S" })).not.toBe(reviewQueueId("VA", { label: "pigweed", source_id: "T" }));
  });
});
