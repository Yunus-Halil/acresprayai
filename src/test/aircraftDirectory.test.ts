// The aircraft directory, and the promise it makes: every number in it either
// came off a manufacturer's page or is null.
//
// These tests exist because the failure mode is invisible. A fabricated tank
// capacity does not throw, does not look wrong, and does not surface until a
// spray report reconciles a logged volume against it and quietly agrees.
import { describe, it, expect } from "vitest";
import {
  AIRCRAFT, AIRCRAFT_DIRECTORY_VERSION, aircraftById, aircraftByMake,
  customModelLabel, EMPTY_CUSTOM_AIRCRAFT, isCustomAircraft, isAircraftOverride,
  isSprayer, missingSeededFields, rolesLabel, validateCustomAircraft,
  type CustomAircraft,
} from "@/lib/aircraftDirectory";
import {
  DRONE_SPECS, DRONE_SPEC_KNOWN, MODEL_IDS, passSpacingM, resolveDroneSpec,
  specSheet, swathIsStated, tankIsStated,
} from "@/lib/droneSpecs";

describe("aircraft directory integrity", () => {
  it("is versioned, so a stored model string can be traced to what we knew", () => {
    expect(AIRCRAFT_DIRECTORY_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("has a unique id, a make, a model and at least one role per entry", () => {
    const ids = new Set<string>();
    for (const a of AIRCRAFT) {
      expect(a.id, a.id).toBeTruthy();
      expect(ids.has(a.id), `duplicate id ${a.id}`).toBe(false);
      ids.add(a.id);
      expect(a.make, a.id).toBeTruthy();
      expect(a.model, a.id).toBeTruthy();
      expect(a.roles.length, a.id).toBeGreaterThan(0);
      for (const r of a.roles) expect(["spray", "mapping"], a.id).toContain(r);
    }
  });

  // The whole point of the file. A figure with no provenance is not allowed to
  // be a figure: it is null, and the operator is asked.
  it("never carries a capacity or swath without a dated manufacturer source", () => {
    for (const a of AIRCRAFT) {
      if (a.tank_l != null || a.swath_m != null) {
        expect(a.source, `${a.id} has figures but no source`).toBeTruthy();
        expect(a.verified, `${a.id} has figures but no verification date`).toBeTruthy();
      }
    }
  });

  it("explains every blank rather than leaving it unremarked", () => {
    for (const a of AIRCRAFT) {
      if (isSprayer(a) && a.tank_l == null) {
        expect(a.note, `${a.id} is a sprayer with no capacity and no note`).toBeTruthy();
        expect(a.note.length, a.id).toBeGreaterThan(20);
      }
    }
  });

  it("gives every non-sprayer a null capacity, never a zero dressed as a fact", () => {
    for (const a of AIRCRAFT) {
      if (!isSprayer(a)) {
        expect(a.tank_l, a.id).toBeNull();
        expect(a.swath_m, a.id).toBeNull();
      }
    }
  });

  it("keeps a stated swath inside the range its maker published", () => {
    for (const a of AIRCRAFT) {
      if (a.swath_m != null && a.swath_published_m) {
        const [lo, hi] = a.swath_published_m;
        expect(a.swath_m, a.id).toBeGreaterThanOrEqual(lo);
        expect(a.swath_m, a.id).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("seeds the aircraft ag operators actually fly, across all three makers", () => {
    const ids = AIRCRAFT.map(a => a.id);
    for (const id of [
      "DJI Agras T10", "DJI Agras T16", "DJI Agras T20", "DJI Agras T20P",
      "DJI Agras T25", "DJI Agras T30", "DJI Agras T40", "DJI Agras T50",
      "DJI Agras T100",
      "XAG P40", "XAG P100", "XAG P100 Pro", "XAG P150", "XAG V40",
      "Hylio AG-110", "Hylio AG-116", "Hylio AG-122", "Hylio AG-130", "Hylio AG-272",
      "DJI Mavic 3M", "DJI Air 3S", "DJI Phantom 4 Multispectral",
      "DJI Matrice 300 RTK", "DJI Matrice 350 RTK",
    ]) {
      expect(ids, `${id} missing from the directory`).toContain(id);
    }
  });

  it("groups by make for a picker that stays navigable at thirty-odd entries", () => {
    const groups = aircraftByMake();
    expect(groups.map(g => g.make)).toContain("DJI");
    expect(groups.map(g => g.make)).toContain("XAG");
    expect(groups.map(g => g.make)).toContain("Hylio");
    expect(groups.reduce((n, g) => n + g.aircraft.length, 0)).toBe(AIRCRAFT.length);
  });

  it("labels a dual-role aircraft as both rather than picking one", () => {
    expect(rolesLabel(["spray", "mapping"])).toBe("Sprayer + survey");
    expect(rolesLabel(["spray"])).toBe("Sprayer");
    expect(rolesLabel(["mapping"])).toBe("Survey");
    // XAG says the V40 sprays, spreads AND maps; the directory does not flatten
    // that to whichever role happened to be listed first.
    expect(aircraftById("XAG V40")!.roles).toEqual(["spray", "mapping"]);
  });
});

describe("seeded aircraft resolve into planner specs", () => {
  it("offers every directory entry in the picker", () => {
    expect(MODEL_IDS.length).toBe(AIRCRAFT.length);
    for (const id of MODEL_IDS) expect(DRONE_SPECS[id], id).toBeDefined();
  });

  it("carries a published capacity straight through to the spec", () => {
    expect(resolveDroneSpec("DJI Agras T100").spec.tank_l).toBe(100);
    expect(resolveDroneSpec("DJI Agras T70P").spec.tank_l).toBe(70);
    expect(resolveDroneSpec("XAG P150").spec.tank_l).toBe(70);
    expect(resolveDroneSpec("Hylio AG-272").spec.tank_l).toBe(68);
  });

  // The regression the whole design is built to prevent.
  it("reports an unpublished capacity as unknown instead of inventing one", () => {
    const t16 = resolveDroneSpec("DJI Agras T16");
    expect(t16.isCustom).toBe(false);
    expect(tankIsStated(t16)).toBe(false);
    expect(t16.spec.tank_l).toBe(0);
    // Specifically NOT the fallback shape's 30 L, which is what a naive merge
    // would have produced and what nobody would have noticed.
    expect(t16.spec.tank_l).not.toBe(DRONE_SPECS["Custom"].tank_l);
  });

  it("reports a range-only swath as unstated so the operator sets it", () => {
    const t50 = resolveDroneSpec("DJI Agras T50");
    expect(tankIsStated(t50)).toBe(true);       // 40 L is published
    expect(swathIsStated(t50)).toBe(false);     // 4-11 m is a range, not a figure
    expect(aircraftById("DJI Agras T50")!.swath_published_m).toEqual([4, 11]);
  });

  it("prints Not published rather than a placeholder on a spec card", () => {
    const r = resolveDroneSpec("DJI Agras T16");
    const rows = Object.fromEntries(specSheet(r.spec, r.known).map(x => [x.k, x.v]));
    expect(rows["Tank"]).toBe("Not published");
    expect(rows["Weight"]).toBe("Not published");
    // A T40 card still reads as it always did.
    const t40 = resolveDroneSpec("DJI Agras T40");
    const t40Rows = Object.fromEntries(specSheet(t40.spec, t40.known).map(x => [x.k, x.v]));
    expect(t40Rows["Tank"]).toBe("40 L");
    expect(t40Rows["Swath"]).toBe("9 m");
  });
});

describe("existing fleet rows are unaffected", () => {
  // The named regression: an RG5-67 registered as a T40 must plan exactly as it
  // did before the directory existed. Its lanes, its grid cells and its
  // chemical volume all hang off these three numbers.
  it("plans a T40 on the same numbers it always did", () => {
    const t40 = resolveDroneSpec("DJI Agras T40");
    expect(t40.isCustom).toBe(false);
    expect(t40.spec.tank_l).toBe(40);
    expect(t40.spec.spray_swath_m).toBe(9);
    expect(t40.spec.spray_rate_lpm).toBe(24);
    expect(t40.spec.max_flight_min).toBe(18);
    expect(t40.spec.spray_overlap).toBe(0.10);
    expect(passSpacingM(t40.spec)).toBeCloseTo(8.1, 6);
  });

  it("keeps the conservative planning swath even though DJI publishes wider", () => {
    // DJI quotes 11 m for the T40 at 2.5 m AGL. SwathWise plans 8.1 m lanes off
    // a 9 m boom on purpose; adopting the published figure would silently widen
    // every existing mission's lanes and open under-dosed strips between them.
    expect(aircraftById("DJI Agras T40")!.swath_m).toBe(11);
    expect(DRONE_SPECS["DJI Agras T40"].spray_swath_m).toBe(9);
  });

  it("still resolves the other shipped profiles unchanged", () => {
    expect(DRONE_SPECS["DJI Agras T30"].spray_swath_m).toBe(6.5);
    expect(DRONE_SPECS["DJI Agras T25"].tank_l).toBe(20);
    expect(DRONE_SPECS["XAG P100 Pro"].spray_swath_m).toBe(10);
    expect(DRONE_SPECS["XAG V40"].tank_l).toBe(16);
    expect(DRONE_SPECS["DJI Mavic 3M"].max_flight_min).toBe(43);
  });

  it("keeps a legacy partial spec working for rows saved before all this", () => {
    const { spec, isCustom } = resolveDroneSpec("Homebrew Hexacopter", { tank_l: 7 });
    expect(isCustom).toBe(true);
    expect(spec.tank_l).toBe(7);
    expect(spec.min_turn_radius_m).toBeGreaterThan(0);
  });
});

describe("custom aircraft", () => {
  const hexa: CustomAircraft = {
    kind: "custom", make: "Homebrew", model: "Hexa 6", roles: ["spray"],
    tank_l: 22, swath_m: 5.5,
  };

  it("starts blank, with nothing borrowed from anywhere", () => {
    expect(EMPTY_CUSTOM_AIRCRAFT.tank_l).toBeNull();
    expect(EMPTY_CUSTOM_AIRCRAFT.swath_m).toBeNull();
    expect(EMPTY_CUSTOM_AIRCRAFT.make).toBe("");
    expect(EMPTY_CUSTOM_AIRCRAFT.model).toBe("");
  });

  it("refuses a sprayer with no tank capacity, and says why", () => {
    const errors = validateCustomAircraft({ ...hexa, tank_l: null });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/tank capacity/i);
    expect(errors[0]).toMatch(/reconcile/i);
  });

  it("does not require a tank for a mapping-only aircraft", () => {
    expect(validateCustomAircraft({
      ...hexa, roles: ["mapping"], tank_l: null, swath_m: null,
    })).toEqual([]);
  });

  it("treats a blank swath as blank, not as an error and not as a default", () => {
    expect(validateCustomAircraft({ ...hexa, swath_m: null })).toEqual([]);
    const r = resolveDroneSpec(customModelLabel(hexa), { ...hexa, swath_m: null });
    expect(swathIsStated(r)).toBe(false);
    expect(r.spec.spray_swath_m).toBe(0);
  });

  it("is a first-class aircraft: it plans on its own numbers", () => {
    const r = resolveDroneSpec(customModelLabel(hexa), hexa);
    expect(r.isCustom).toBe(true);
    expect(r.key).toBe("Homebrew Hexa 6");
    expect(tankIsStated(r)).toBe(true);
    expect(r.spec.tank_l).toBe(22);
    expect(swathIsStated(r)).toBe(true);
    expect(r.spec.spray_swath_m).toBe(5.5);
    expect(passSpacingM(r.spec)).toBeCloseTo(5.5 * 0.9, 6);
  });

  // The bug this replaced: custom specs lived on the FIELD, so every custom
  // aircraft in a fleet shared one tank.
  it("gives two custom aircraft two different sets of numbers", () => {
    const other: CustomAircraft = {
      kind: "custom", make: "Homebrew", model: "Octo 8", roles: ["spray"],
      tank_l: 45, swath_m: 8,
    };
    expect(resolveDroneSpec(customModelLabel(hexa), hexa).spec.tank_l).toBe(22);
    expect(resolveDroneSpec(customModelLabel(other), other).spec.tank_l).toBe(45);
  });

  it("never inherits a capacity from a seeded model with a similar name", () => {
    // Named to look exactly like the seeded T40, and still gets nothing.
    const lookalike: CustomAircraft = {
      kind: "custom", make: "DJI", model: "Agras T41", roles: ["spray"],
      tank_l: null, swath_m: null,
    };
    const r = resolveDroneSpec("DJI Agras T41", lookalike);
    expect(r.isCustom).toBe(true);
    expect(r.spec.tank_l).toBe(0);
    expect(tankIsStated(r)).toBe(false);
    expect(r.spec.tank_l).not.toBe(DRONE_SPECS["DJI Agras T40"].tank_l);
  });

  it("recognises its own stored shape and not a legacy spec dump", () => {
    expect(isCustomAircraft(hexa)).toBe(true);
    expect(isCustomAircraft({ tank_l: 30 })).toBe(false);
    expect(isCustomAircraft(null)).toBe(false);
  });
});

describe("operator overrides on a seeded aircraft", () => {
  it("asks for exactly the figures the maker never published", () => {
    const t16 = aircraftById("DJI Agras T16")!;
    expect(missingSeededFields(t16)).toEqual({ tank: true, swath: true });
    const t50 = aircraftById("DJI Agras T50")!;
    expect(missingSeededFields(t50)).toEqual({ tank: false, swath: true });
    const t40 = aircraftById("DJI Agras T40")!;
    expect(missingSeededFields(t40)).toEqual({ tank: false, swath: false });
  });

  it("asks nothing of a mapping aircraft", () => {
    expect(missingSeededFields(aircraftById("DJI Mavic 3M")!)).toEqual({ tank: false, swath: false });
  });

  it("counts an operator figure as known once supplied", () => {
    const override = { kind: "override" as const, tank_l: 16, swath_m: 6 };
    expect(missingSeededFields(aircraftById("DJI Agras T16")!, override))
      .toEqual({ tank: false, swath: false });
    const r = resolveDroneSpec("DJI Agras T16", override);
    expect(r.isCustom).toBe(false);          // still the seeded airframe
    expect(r.entry?.id).toBe("DJI Agras T16");
    expect(tankIsStated(r)).toBe(true);
    expect(r.spec.tank_l).toBe(16);
    expect(r.spec.spray_swath_m).toBe(6);
  });

  it("ignores an empty override rather than zeroing a published figure", () => {
    const r = resolveDroneSpec("DJI Agras T40", { kind: "override", tank_l: null, swath_m: null });
    expect(r.spec.tank_l).toBe(40);
    expect(r.spec.spray_swath_m).toBe(9);
  });

  it("never lets a stray kind field leak into a spec", () => {
    const r = resolveDroneSpec("Not A Real Model", { kind: "override", tank_l: 12, swath_m: null });
    expect((r.spec as Record<string, unknown>).kind).toBeUndefined();
    expect(isAircraftOverride({ kind: "override", tank_l: 1, swath_m: null })).toBe(true);
    expect(isAircraftOverride({ kind: "custom" })).toBe(false);
  });
});

describe("known-field bookkeeping", () => {
  it("claims a field as known only when something real supplied it", () => {
    for (const id of MODEL_IDS) {
      const entry = aircraftById(id)!;
      const known = DRONE_SPEC_KNOWN[id];
      if (isSprayer(entry) && entry.tank_l == null) {
        expect(known.has("tank_l"), id).toBe(false);
      }
      if (isSprayer(entry) && entry.tank_l != null) {
        expect(known.has("tank_l"), id).toBe(true);
      }
    }
  });
});
