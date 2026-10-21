// The planting-practice catalogue: what a fitted frame is usually called, the staggers a crew lays out, and the doubts.
import { describe, expect, it } from "vitest";
import { ORCHARD_PRACTICE, ROW_CROP_PITCHES_M, describePlanting, snapStagger } from "@/lib/plantingPractice";
import { ROW_SPACINGS_M, nearestPlantedSpacing, pitchAmbiguityNote } from "@/lib/weedScout/rows";

describe("the planting catalogue", () => {
  it("names the frame a fitted orchard matches, Turkey among the regions", () => {
    const d = describePlanting(3.2, 5.1);
    expect(d.matches.length).toBeGreaterThan(0);
    expect(d.text).toMatch(/apricot|peach|cherry|citrus|almond|pear/);
    expect(d.doubt).toBeNull();
    const t = describePlanting(6, 6);
    expect(t.text).toMatch(/Turkey/);
    expect(t.matches.map(e => e.crop)).toEqual(expect.arrayContaining(["apricot", "olive"]));
  });

  it("names a tall-spindle apple frame and a hedgerow, and doubts a half spacing or a swapped axis", () => {
    expect(describePlanting(0.9, 3.35).matches.some(e => e.crop === "apple")).toBe(true);
    expect(describePlanting(1.3, 3.8).matches.some(e => e.crop === "olive")).toBe(true);
    expect(describePlanting(0.5, 7.5).doubt).toMatch(/half the true one/); // (0.5 m on 5 m rows is a high-density pear frame, so no doubt there)
    expect(describePlanting(6, 2.5).doubt).toMatch(/same row/);
    expect(describePlanting(2.2, 20).doubt).toBeNull(); // no frame, no diagnosis: just "not in the catalogue"
    expect(describePlanting(2.2, 20).text).toMatch(/not a frame/);
  });

  it("every entry has a sane range, and the row-crop pitches feed the row finder", () => {
    for (const e of ORCHARD_PRACTICE) {
      expect(e.pitchM[0]).toBeLessThanOrEqual(e.pitchM[1]);
      if (e.alongM) expect(e.alongM[0]).toBeLessThanOrEqual(e.alongM[1]);
      expect(e.stagger.length).toBeGreaterThan(0);
    }
    expect(ROW_SPACINGS_M).toBe(ROW_CROP_PITCHES_M);
    expect(nearestPlantedSpacing(0.70)?.crop).toBe("corn");
    expect(nearestPlantedSpacing(0.45)?.crop).toBe("sugar beet");
    expect(nearestPlantedSpacing(24)?.crop).toBe("tramline");
    expect(pitchAmbiguityNote(0.38, 0.762)).toMatch(/twin rows|every second row/);
    expect(pitchAmbiguityNote(0.76, 24)).toMatch(/tramline/);
  });

  it("snaps a stagger to aligned or half-offset only within a twentieth of the spacing", () => {
    const along = 40;
    expect(snapStagger(1.2, along)).toBeCloseTo(0, 9); // 0.03 of the spacing: rows aligned
    expect(snapStagger(19, along)).toBeCloseTo(20, 9); // 0.475: offset by half
    expect(snapStagger(8, along)).toBeCloseTo(8, 9); // 0.2: kept, not a laid-out value
    expect(snapStagger(39, along)).toBeCloseTo(40, 9); // 0.975: aligned, one spacing on
    expect(snapStagger(-1.5, along)).toBeCloseTo(0, 9);
  });
});
