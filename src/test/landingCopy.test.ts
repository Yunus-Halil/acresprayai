// The landing page's copy, held to its own rules.
//
// copy.ts states eight rules at the top: no capability the product lacks, no
// social proof, no em or en dashes in anything a visitor reads, and data
// agnostic with no manufacturer named. The first two are judgement and get
// reviewed by a person. The last two are mechanical, and a mechanical rule that is not enforced is a rule
// every later edit breaks. This is the enforcement.
//
// It also pins the closed-testing state: no "Sign up", no "Apply to Pilot", one
// wording on every button.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESS, ACCESS_HREF, AUDIENCES, BEYOND, CTA_EXPLORE, CTA_PRIMARY, HERO, NAV, OPERATIONS, PLANT, STATUS_BADGE,
} from "@/components/landing/copy";

const LANDING = join(__dirname, "..", "components", "landing");

/** Every string a visitor can read, flattened out of copy.ts. */
const VISIBLE: string[] = [
  STATUS_BADGE, CTA_PRIMARY, CTA_EXPLORE, ...NAV.map(n => n.label),
  HERO.headline, ...HERO.lines, HERO.sub, HERO.brand,
  BEYOND.heading, BEYOND.caption, BEYOND.photosLabel, ...BEYOND.stages.flatMap(s => [s.label, s.line]),
  PLANT.heading, PLANT.across, PLANT.ground, PLANT.seen, PLANT.seenValue, PLANT.seenNote, PLANT.caption,
  OPERATIONS.heading, ...OPERATIONS.steps.flatMap(s => [s.label, s.line, s.alt]),
  AUDIENCES.heading, ...AUDIENCES.items.flatMap(a => [a.label, a.line]),
  ACCESS.heading, ACCESS.status, ACCESS.email,
];

/** The redesign brief's headline is the one place "every" is allowed (2026-10-27). */
const EVERY_ALLOWED = new Set([HERO.headline, HERO.lines[0]]);

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

describe("data agnostic", () => {
  // Rule 4. No drone maker, controller app or vendor file format is named
  // anywhere a visitor reads, the landing components included.
  const BRANDS = /\b(dji|agras|mavic|matrice|wpml|qgc)\b|dji fly|dji pilot/i;

  it("the visible copy names no manufacturer or vendor format", () => {
    expect(VISIBLE.filter(s => BRANDS.test(s))).toEqual([]);
  });

  it("nor does any inline string in the landing components", () => {
    const lines = componentSource().split("\n").filter(l => BRANDS.test(l));
    expect(lines).toEqual([]);
  });

  it("never says 'any drone' beside spraying", () => {
    const all = VISIBLE.join(" ");
    expect(all).not.toMatch(/any drone|any camera|any crop/i);
  });
});

describe("written for a farmer", () => {
  // Rule 5. Mechanical half: no British spelling and no jargon a farmer would
  // have to look up. The judgement half (tone, jabs at other tools) is read by
  // a person.
  const BRITISH = /\b(colour(ed|s)?|centre|litres?|neighbours?|modelled|licence|programme|metres?)\b/i;
  const JARGON = /\b(orthomosaic|multispectral|waypoint|sub-swath|prescription grid|data agnostic|amp-seconds)\b/i;

  it("the visible copy is in US English", () => {
    expect(VISIBLE.filter(s => BRITISH.test(s))).toEqual([]);
  });

  it("nor is any inline string in the landing components in British English", () => {
    const lines = componentSource().split("\n").filter(l => BRITISH.test(l));
    expect(lines).toEqual([]);
  });

  it("uses no jargon a farmer would have to look up", () => {
    expect(VISIBLE.filter(s => JARGON.test(s))).toEqual([]);
    const lines = componentSource().split("\n").filter(l => JARGON.test(l));
    expect(lines).toEqual([]);
  });

  it("puts no unmeasured time saving on the page", () => {
    expect(VISIBLE.join(" ")).not.toMatch(/\b(ten|\d+) minutes\b/i);
  });
});

describe("the pilot flies", () => {
  it("says the flight is the applicator's", () => {
    expect(VISIBLE.join(" ")).toMatch(/your license/i);
  });

  it("never puts 'any drone' in the same sentence as spraying on its own", () => {
    // "Any drone" is the imagery claim. Only a spray aircraft sprays.
    const sentences = VISIBLE.flatMap(s => s.split(/(?<=[.!?])\s+/));
    const offenders = sentences.filter(s => /any drone/i.test(s) && /spray/i.test(s) && !/spray aircraft/i.test(s));
    expect(offenders).toEqual([]);
  });
});

describe("nothing points off-site", () => {
  it("has no demo video link and no second call to action", () => {
    const src = componentSource();
    expect(src).not.toMatch(/drive\.google|youtube|vimeo/i);
    expect(src).not.toMatch(/Watch it work/);
  });
});

describe("closed testing", () => {
  it("has one primary call to action, and it asks for access rather than promising a place", () => {
    expect(CTA_PRIMARY).toBe("Request access");
    expect(ACCESS_HREF).toBe("/apply");
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
  it("keeps the redesign's hero and the brand line", () => {
    // The hero is word for word from the 2026-10-27 redesign brief. The brand
    // line is kept verbatim; it moved to the footer.
    expect(HERO.headline).toBe("Every field. Understood.");
    expect(HERO.lines.join(" ")).toBe(HERO.headline);
    expect(HERO.sub).toBe("From drone imagery to field intelligence.");
    expect(HERO.brand).toBe("Precision Agriculture, Precisely Simple.");
    expect(VISIBLE.join(" ")).toMatch(/weed/i);
  });

  it("names the findings that are not weeds", () => {
    const all = VISIBLE.join(" ");
    expect(all).toMatch(/bare (or wet )?ground/i);
    expect(all).toMatch(/thin stand/i);
    expect(all).toMatch(/wet/i);
  });
});

describe("the method is a trade secret", () => {
  // Rule 9. The page says what it finds and never how: no pattern, no rows,
  // no spacing, no signal, no step of the method, in copy.ts or inline.
  const METHOD = /planting pattern|crop pattern|\brows\b|row spacing|spacing|learns (your|the) (field|rows)|vegetation index|signal|threshold|algorithm|detector/i;

  it("the visible copy describes no step of the method", () => {
    expect(VISIBLE.filter(s => METHOD.test(s))).toEqual([]);
  });

  it("nor does any inline string in the landing components", () => {
    // A line of visitor text is one with no tag, no brace and no equals sign: JSX text, nothing else.
    const lines = componentSource().split("\n").filter(l => /^\s*[^<{}=]+$/.test(l) && !/^\s*(\*|\/\/)/.test(l) && METHOD.test(l));
    expect(lines).toEqual([]);
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

  it("presents nothing unmeasured as an established result", () => {
    // Rule 8 as rewritten on 2026-10-27 (the redesign brief): no turnaround
    // time, no accuracy figure, and no claim that it finds every weed. The
    // 2026-10-08 "finds the weeds, all of them" line is gone on purpose.
    expect(all).not.toMatch(/all of them|every weed|accura|(hours?|minutes?|days?)|turnaround/i);
    // "Every" only in the brief's headline: Yunus, 2026-10-08, with that one exception.
    expect(VISIBLE.filter(s => /every/i.test(s) && !EVERY_ALLOWED.has(s))).toEqual([]);
    expect(all).not.toMatch(/does not guess|any drone, any camera/i);
  });

  it("does not sell autonomous flight", () => {
    expect(all).not.toMatch(/autonomous|flies itself|fly itself/i);
  });

});
