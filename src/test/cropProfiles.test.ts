// The Crop Intelligence Profile system: the profiles on disk validate, the run-time files are built from them, crop
// names resolve, the validator refuses what it must, and the four-question checks behave as the profile says.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cropIds, readCrop, readShared, runtimePath } from "../../scripts/cropProfiles/fsProfiles";
import { validateProfile, validateShared } from "@/lib/cropProfiles/load";
import { compileRuntime, type RuntimeCropProfile } from "@/lib/cropProfiles/runtime";
import { cropProfileFor, listCropProfiles, normaliseCropName } from "@/lib/cropProfiles/registry";
import { assessCapabilities, checkCoverVsStage, checkRows, checkRowSpacing, checkVegetationSplit, daysSincePlanting, estimateStage, expectedCover, regionFor, speciesPriors, stageOutside } from "@/lib/cropProfiles/checks";
import { patternPriorFor } from "@/lib/cropProfiles/engine";
import { cropGroupOf, schemeFor } from "@/lib/weedVision/pressure/grade";
import { pressureRefusal } from "@/lib/weedVision/pressure/pressureStore";
import { growthStage } from "@/lib/farmerSettings";
import { cropContextFor } from "@/lib/weedCatalog/region";
import { photoPassParams, photoReadKey } from "@/lib/weedScout/photoPass";

const shared = (() => { const r = validateShared(readShared()); if (!r.shared) throw new Error(r.errors.join("\n")); return r.shared; })();
const corn = cropProfileFor("corn")!;
const at = (planting: string, days: number) => new Date(Date.parse(`${planting}T12:00:00Z`) + days * 86_400_000);

describe("profiles on disk", () => {
  it("the shared vocabularies validate", () => {
    expect(validateShared(readShared()).errors).toEqual([]);
  });

  it("every crop profile validates against the schema and its cross-references", () => {
    expect(cropIds()).toContain("corn");
    for (const id of cropIds()) {
      const r = validateProfile(readCrop(id), shared);
      expect(r.errors, id).toEqual([]);
    }
  });

  it("every run-time file is exactly what its profile compiles to (run npm run profiles:build after editing a profile)", () => {
    for (const id of cropIds()) {
      const r = validateProfile(readCrop(id), shared);
      const built = JSON.parse(JSON.stringify(compileRuntime(r.profile!, shared)));
      const onDisk = JSON.parse(readFileSync(runtimePath(id), "utf8"));
      expect(onDisk, id).toEqual(built);
    }
  });

  it("the bundled registry holds the same run-time profiles", () => {
    expect(listCropProfiles().map(p => p.id).sort()).toEqual(cropIds());
  });

  it("corn is experimental, not validated: its benchmarks have not all met their acceptance criteria", () => {
    expect(corn.status).toBe("experimental");
    expect(corn.validation).not.toBe("validated");
  });
});

describe("the validator refuses what it must", () => {
  // The documents are mutated freely below to break them; their exact types do not matter here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = () => JSON.parse(JSON.stringify(readCrop("corn"))) as Record<string, any>;

  it("a citation with no reference", () => {
    const d = base();
    d.planting.patterns[0].evidence.sources.push("no-such-source");
    expect(validateProfile(d, shared).errors.join()).toMatch(/no-such-source/);
  });

  it("an unknown stage, region, species, unit or uncertainty code", () => {
    const d = base();
    d.algorithms.pressure.applicableStages = ["V1", "V99"];
    d.weeds.regions[0].associations[0].speciesId = "not-a-weed";
    d.planting.patterns[0].regions.push("atlantis");
    d.planting.patterns[0].rowSpacingM.unit = "furlong";
    d.uncertainty.policies[0].code = "MADE_UP";
    const e = validateProfile(d, shared).errors.join("\n");
    for (const s of ["V99", "not-a-weed", "atlantis", "furlong", "MADE_UP"]) expect(e).toContain(s);
  });

  it("a provisional threshold that does not say so", () => {
    const d = base();
    d.algorithms.pressure.scheme.source = "Act at 10% cover.";
    expect(validateProfile(d, shared).errors.join()).toMatch(/provisional/);
  });

  it("a capability coarser than its imagery requirement", () => {
    const d = base();
    d.algorithms.capabilities["weed-measurement"].maxGsdCm = 5;
    expect(validateProfile(d, shared).errors.join()).toMatch(/weed-measurement.*coarser/);
  });

  it("a profile marked validated without run benchmarks that met their criteria", () => {
    const d = base();
    d.manifest.status = "validated";
    const e = validateProfile(d, shared).errors.join("\n");
    expect(e).toMatch(/validation.status is not/);
    expect(e).toMatch(/no run benchmark meeting its acceptance criteria/);
  });

  it("metrics on a benchmark that was not run", () => {
    const d = base();
    const b = d.validation.benchmarks.find((x: { status: string }) => x.status === "planned") ?? d.validation.benchmarks[0];
    b.status = "planned"; b.metrics = { made: 1 };
    expect(validateProfile(d, shared).errors.join()).toMatch(/not run/);
  });
});

describe("crop names resolve to a profile", () => {
  it("by alias, in any case, in Turkish, Portuguese and German, and as a whole word", () => {
    for (const n of ["Corn", "corn", "MAIZE", "maize", "Mısır", "MISIR", "misir", "milho", "Mais", "maïs", "grain corn (P1197)", "Sweet corn", "corn_silage"]) expect(cropProfileFor(n)?.id, n).toBe("corn");
  });
  it("and not by substring or for crops without a profile", () => {
    for (const n of ["peppercorn", "cornflower", "popcornish", "Soybeans", "Wheat", "", null, undefined]) expect(cropProfileFor(n as string), String(n)).toBeNull();
    expect(normaliseCropName("  Grain_Corn ")).toBe("grain corn");
  });
});

describe("question 1: what to expect (stage)", () => {
  it("no planting date: stage unknown, never guessed", () => {
    expect(estimateStage(corn, null, new Date()).status).toBe("unknown");
    expect(estimateStage(corn, "2026-05-01", new Date("2026-04-01")).status).toBe("unknown");
    expect(daysSincePlanting("not a date", new Date())).toBeNull();
  });

  it("a range of stages from the calendar, never one stage, widening with the days", () => {
    const e = estimateStage(corn, "2026-05-01", at("2026-05-01", 16));
    expect(e.status).toBe("estimated");
    if (e.status !== "estimated") return;
    expect(e.from.order).toBeLessThanOrEqual(1); // VE or V1
    expect(e.to.order).toBeGreaterThanOrEqual(3);
    expect(e.note).toMatch(/estimated from the planting date/);
    const later = estimateStage(corn, "2026-05-01", at("2026-05-01", 70));
    if (later.status !== "estimated") throw new Error("expected an estimate");
    expect(later.from.order).toBeGreaterThan(e.to.order);
  });

  it("knows when the alley has closed for the grade (30 in rows close about V10)", () => {
    const early = estimateStage(corn, "2026-05-01", at("2026-05-01", 20));
    const late = estimateStage(corn, "2026-05-01", at("2026-05-01", 75));
    expect(stageOutside(corn, early, corn.pressure.applicableStages)).toBeNull();
    expect(stageOutside(corn, late, corn.pressure.applicableStages)).toBe("after");
  });
});

describe("question 3: are the observations consistent with corn?", () => {
  it("a measured pitch near a planted spacing is consistent; far from all of them is flagged, never corrected", () => {
    expect(checkRowSpacing(corn, 0.765).finding).toBeNull();
    expect(checkRowSpacing(corn, 0.765).nearest?.label).toBe("30 in");
    expect(checkRowSpacing(corn, 0.51).finding).toBeNull();
    const odd = checkRowSpacing(corn, 1.3);
    expect(odd.finding?.code).toBe("ROW_SPACING_UNEXPECTED");
    expect(odd.finding?.detail).toMatch(/130 cm/);
  });

  it("rows: none, incoherent, or brightness-only", () => {
    expect(checkRows(corn, { found: false })?.code).toBe("NO_ROWS");
    expect(checkRows(corn, { found: true, coherence: 0.2 })?.code).toBe("ROWS_UNCERTAIN");
    expect(checkRows(corn, { found: true, coherence: 0.8, fromBrightnessShare: 0.9 })?.code).toBe("ROWS_UNCERTAIN");
    expect(checkRows(corn, { found: true, coherence: 0.8 })).toBeNull();
  });

  it("an automatic green split below the index of grey is suspect", () => {
    expect(checkVegetationSplit(corn, -0.2)?.code).toBe("VEGETATION_MASK_SUSPECT");
    expect(checkVegetationSplit(corn, 0.27)).toBeNull();
  });

  it("green cover far from what corn covers at the estimated stage is flagged for review", () => {
    const v3 = estimateStage(corn, "2026-05-01", at("2026-05-01", 20));
    const exp = expectedCover(corn, v3)!;
    expect(exp.low).toBeLessThan(0.05);
    expect(checkCoverVsStage(corn, v3, 0.03)).toBeNull();
    expect(checkCoverVsStage(corn, v3, 0.9)?.code).toBe("COVER_STAGE_MISMATCH");
  });
});

describe("question 4: what can safely be concluded (capabilities)", () => {
  const state = (a: ReturnType<typeof assessCapabilities>, id: string) => a.capabilities.find(c => c.id === id)!;

  it("unknown pixel size disables every metric analysis", () => {
    const a = assessCapabilities(corn, { gsdM: null, on: new Date() });
    for (const id of ["row-spacing", "weed-measurement", "weed-isolation", "between-row-weed-cover", "planting-positions"]) expect(state(a, id).state, id).toBe("disabled");
    expect(state(a, "weed-measurement").findings[0].code).toBe("UNKNOWN_RESOLUTION");
  });

  it("too coarse a pixel disables what needs a finer one, with the limit named", () => {
    const a = assessCapabilities(corn, { gsdM: 0.04, on: new Date() });
    expect(state(a, "weed-measurement").state).toBe("disabled");
    expect(state(a, "between-row-weed-cover").state).toBe("disabled");
    expect(state(a, "between-row-weed-cover").findings[0].detail).toMatch(/4\.0 cm.*3 cm/);
    expect(state(a, "row-detection").state).toBe("enabled"); // 4 cm still reads 76 cm rows
  });

  it("past canopy closure the between-row analyses are off, with the stage named", () => {
    const a = assessCapabilities(corn, { gsdM: 0.01, plantingDate: "2026-05-01", on: at("2026-05-01", 80) });
    expect(state(a, "between-row-weed-cover").state).toBe("disabled");
    expect(state(a, "between-row-weed-cover").findings.some(f => f.code === "UNSUPPORTED_STAGE")).toBe(true);
  });

  it("a closed canopy seen in the imagery turns off between-row cover whatever the calendar says", () => {
    const a = assessCapabilities(corn, { gsdM: 0.01, on: new Date(), vegetationShare: 0.9 });
    expect(state(a, "between-row-weed-cover").state).toBe("disabled");
    expect(a.findings.some(f => f.code === "CANOPY_CLOSED")).toBe(true);
  });

  it("no rows turns off the position rule; in-row weeds are always declared out of reach", () => {
    const a = assessCapabilities(corn, { gsdM: 0.01, on: new Date(), rowsFound: false });
    expect(state(a, "crop-vs-weed-by-position").state).toBe("disabled");
    const b = assessCapabilities(corn, { gsdM: 0.01, on: new Date(), rowsFound: true, rowCoherence: 0.8 });
    expect(state(b, "crop-vs-weed-by-position").state).toBe("enabled");
    expect(state(b, "crop-vs-weed-by-position").findings.some(f => f.code === "WITHIN_ROW_UNRESOLVED")).toBe(true);
  });

  it("the map grade is experimental for corn, provisional, and off on a map coarser than 3 cm; species carry the not-an-identification note", () => {
    const a = assessCapabilities(corn, { gsdM: 0.01, on: new Date() });
    expect(state(a, "weed-pressure-grade").state).toBe("enabled");
    expect(state(a, "weed-pressure-grade").status).toBe("experimental");
    expect(state(a, "weed-pressure-grade").findings.some(f => f.code === "THRESHOLD_PROVISIONAL")).toBe(true);
    const coarse = assessCapabilities(corn, { gsdM: 0.05, on: new Date() });
    expect(state(coarse, "weed-pressure-grade").state).toBe("disabled");
    expect(state(coarse, "weed-pressure-grade").findings[0].code).toBe("INSUFFICIENT_RESOLUTION");
    expect(state(a, "species-priors").findings.some(f => f.code === "SPECIES_NOT_RESOLVABLE")).toBe(true);
  });
});

describe("species priors are a regional, seasonal reference list", () => {
  it("Virginia maps to the Mid-Atlantic; the list is ordered by season then prevalence; unknown places give nothing", () => {
    expect(regionFor(corn, { state: "VA" })).toBe("us-mid-atlantic");
    expect(regionFor(corn, { state: "IA" })).toBe("us-corn-belt");
    expect(regionFor(corn, { country: "TR" })).toBe("turkey");
    expect(regionFor(corn, { state: "ZZ" })).toBeNull();
    const st = estimateStage(corn, "2026-05-01", at("2026-05-01", 20));
    const list = speciesPriors(corn, "us-mid-atlantic", st, 5);
    expect(list.length).toBe(5);
    expect(list[0].inSeason).toBe(true);
    expect(speciesPriors(corn, null, st)).toEqual([]);
  });
});

describe("the engine reads the profile; crops without one are unchanged", () => {
  it("crop group and cover classes come from the profile, with the same numbers as before and marked provisional", () => {
    expect(cropGroupOf("maize", false)).toBe("wide-row");
    expect(cropGroupOf("Mısır", false)).toBe("wide-row");
    const s = schemeFor("wide-row", "corn");
    expect([s.low, s.moderate, s.action, s.high]).toEqual([0.01, 0.05, 0.10, 0.20]);
    expect(s.basis).toBe("provisional");
    expect(s.source).toMatch(/Provisional/);
    expect(schemeFor("wide-row", "cotton").basis).toBeUndefined();
  });

  it("the grade refuses corn on the tree reader's rows, waits for confirmed pattern rows, and refuses past closure", () => {
    const readerRows = { source: "reader" as const } as never;
    const layoutRows = { source: "layout" as const } as never;
    expect(pressureRefusal("corn", readerRows)).toMatch(/^Corn rows have not been read from the map yet/);
    expect(pressureRefusal("corn", { source: "pattern" } as never)).toMatch(/^Confirm the corn rows first/);
    expect(pressureRefusal("corn", { source: "pattern" } as never, { rowsConfirmed: true })).toBeNull();
    expect(pressureRefusal("corn", layoutRows)).toBeNull();
    const old = new Date(); old.setDate(old.getDate() - 90);
    expect(pressureRefusal("corn", layoutRows, { plantingDate: old.toISOString().slice(0, 10) })).toMatch(/canopy has closed/);
    expect(pressureRefusal("Soybean", readerRows)).toMatch(/^Row-crop grading is not supported yet/);
  });

  it("the growth stage line for corn is the profile's estimated range", () => {
    const planting = "2026-05-01";
    expect(growthStage("corn", planting, at(planting, 21).getTime())).toMatch(/^~3 weeks \(V?E?\w* to V\d+, estimated from the planting date\)$/);
    expect(growthStage("wheat", planting, at(planting, 56).getTime())).toMatch(/tillering|stem extension/);
  });

  it("the weed catalogue's crop context finds corn by any of its names", () => {
    expect(cropContextFor("Mısır")).toBe("corn");
    expect(cropContextFor("maize")).toBe("corn");
  });

  it("photo reads carry the crop's prior, and the saved-read key names it; crop-neutral keys are unchanged", () => {
    const params = { rowSpacingAuto: true, rowSpacingM: 0.762, minBlobCm2: 1 };
    const neutral = photoPassParams(params);
    expect(neutral.prior).toBeUndefined();
    expect(photoReadKey(neutral)).toBe("photo-read-v2|spacing=auto|window=4|minBlob=1|edge=4096");
    const withCorn = photoPassParams({ ...params, crop: "Corn" });
    expect(withCorn.prior?.cropId).toBe("corn");
    expect(photoReadKey(withCorn)).toBe(`photo-read-v2|spacing=auto|window=4|minBlob=1|edge=4096|crop=corn@${corn.version}`);
    expect(photoPassParams({ ...params, crop: "Cotton" }).prior).toBeUndefined();
  });

  it("the pattern prior carries the profile's spacings, gate and checks", () => {
    const p = patternPriorFor(corn as RuntimeCropProfile)!;
    expect(p.spacingCandidatesM).toContain(0.762);
    expect(p.vegetationExgrGate).toBe(0);
    expect(p.verifyBrightness).toBe(true);
    expect(p.plantedSpacingsM).toContain(0.508);
    expect(patternPriorFor(null)).toBeNull();
  });
});
