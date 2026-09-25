// The landing page's copy, held to its own rules.
//
// copy.ts states four rules at the top: no capability the product lacks, no
// social proof, no em or en dashes in anything a visitor reads, and not tied to
// one aircraft. The first two are judgement and get reviewed by a person. The
// last two are mechanical, and a mechanical rule that is not enforced is a rule
// every later edit breaks. This is the enforcement.
//
// It also pins the closed-testing state: no "Sign up", no "Apply to Pilot", one
// wording on every button.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIENCES, CTA_PRIMARY, CTA_SECONDARY, DETECTION, FEATURES, HERO, STATUS_BADGE, STEPS,
} from "@/components/landing/copy";

const LANDING = join(__dirname, "..", "components", "landing");

/** Every string a visitor can read, flattened out of copy.ts. */
const VISIBLE: string[] = [
  STATUS_BADGE, CTA_PRIMARY, CTA_SECONDARY,
  HERO.kicker, HERO.headline, HERO.sub, ...HERO.bullets,
  ...FEATURES.flatMap(f => [f.title, f.body]),
  DETECTION.eyebrow, DETECTION.headline, DETECTION.sub,
  ...DETECTION.steps.flatMap(s => [s.label, s.title, s.body]),
  ...STEPS.flatMap(s => [s.title, s.body]),
  ...AUDIENCES.flatMap(a => [a.title, a.body]),
];

/** The JSX of every landing component, comments stripped, for the strings that live inline. */
const componentSource = (): string =>
  readdirSync(LANDING)
    .filter(n => n.endsWith(".tsx"))
    .map(n => readFileSync(join(LANDING, n), "utf-8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n");

describe("the dash rule", () => {
  it("copy.ts carries no em dash and no en dash in anything visible", () => {
    const offenders = VISIBLE.filter(s => /[—–]/.test(s));
    expect(offenders).toEqual([]);
  });

  it("nor does any inline string in the landing components", () => {
    const lines = componentSource().split("\n").filter(l => /[—–]/.test(l));
    expect(lines).toEqual([]);
  });
});

describe("not one aircraft", () => {
  it("the visible copy does not tie the product to the Agras", () => {
    // Rule 4. The product emits WPML and QGC waypoint files, which DJI Fly, DJI
    // Pilot and most ground stations read, and imagery can come from any camera.
    // "No Agras required" is the one permitted mention, because it says so.
    const offenders = VISIBLE.filter(s => /agras/i.test(s) && !/no agras required/i.test(s));
    expect(offenders).toEqual([]);
  });

  it("no landing component names the Agras as the aircraft either", () => {
    const lines = componentSource().split("\n").filter(l => /agras/i.test(l));
    expect(lines).toEqual([]);
  });

  it("says which files it produces and what reads them", () => {
    const all = VISIBLE.join(" ");
    expect(all).toMatch(/WPML/);
    expect(all).toMatch(/DJI Fly/);
    expect(all).toMatch(/QGC/);
  });
});

describe("closed testing", () => {
  it("has one primary call to action, and it asks for access rather than promising a place", () => {
    expect(CTA_PRIMARY).toBe("Request access");
    expect(STATUS_BADGE).toMatch(/CLOSED TESTING/);
    expect(STATUS_BADGE).toMatch(/INVITE ONLY/);
  });

  it("offers no sign-up and no open pilot anywhere on the landing page", () => {
    const src = componentSource();
    expect(src).not.toMatch(/sign up/i);
    expect(src).not.toMatch(/apply to pilot/i);
    expect(src).not.toMatch(/free usage/i);
  });

  it("keeps the sign-in door for the testers who already have accounts", () => {
    expect(componentSource()).toMatch(/href="\/auth"/);
  });
});

describe("the category", () => {
  it("says precision agriculture, not only weeds", () => {
    // Weeds are the flagship job and the page leads with them. They are not the
    // whole product, and a rewrite narrowed the brand to one feature once
    // already. The category has to be on the page, above the headline.
    expect(HERO.kicker).toMatch(/precision agriculture/i);
    expect(HERO.sub).toMatch(/precision agriculture/i);
  });

  it("names the findings that are not weeds", () => {
    const all = VISIBLE.join(" ");
    expect(all).toMatch(/bare ground/i);
    expect(all).toMatch(/thin stand/i);
    expect(all).toMatch(/wet/i);
  });
});

describe("claims the product can stand behind", () => {
  const all = VISIBLE.join(" ");

  it("promises no savings percentage and no guarantee", () => {
    expect(all).not.toMatch(/\d+\s?%/);
    expect(all).not.toMatch(/guarantee/i);
  });

  it("never claims to name a species from the imagery", () => {
    // Identification is the operator's call, suggested from their own verdicts
    // and a sourced catalog. The copy may not claim the reverse.
    expect(all).not.toMatch(/identifies the species|knows the species|tells you the species/i);
  });

  it("does not sell autonomous flight", () => {
    expect(all).not.toMatch(/autonomous|flies itself|fly itself/i);
  });

});
