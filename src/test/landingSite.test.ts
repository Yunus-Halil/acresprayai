// The public website's wiring: every picture it names exists, every in-page link has a section to land on,
// and the hero's footage list is well formed. A missing frame or a dead anchor is the kind of thing nobody
// sees until a visitor does.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_HREF, NAV } from "@/components/landing/copy";
import { HERO_MEDIA } from "@/components/landing/heroMedia";
import { SPECIMEN } from "@/components/landing/specimen";

const ROOT = join(__dirname, "..", "..");
const PUBLIC = join(ROOT, "public");
const LANDING = join(ROOT, "src", "components", "landing");
const inPublic = (url: string) => existsSync(join(PUBLIC, url.replace(/^\//, "")));
const source = readdirSync(LANDING).filter(n => n.endsWith(".tsx")).map(n => readFileSync(join(LANDING, n), "utf-8")).join("\n");

describe("the website's pictures", () => {
  it("has every Field Twin frame for both screen shapes, and the selected view", () => {
    for (const set of ["desktop", "mobile"]) {
      for (let i = 0; i < 40; i++) expect(inPublic(`/site/twin/${set}/f-${String(i).padStart(2, "0")}.webp`), `${set} frame ${i}`).toBe(true);
      expect(inPublic(`/site/twin/${set}/sel.webp`)).toBe(true);
    }
  });

  it("has the plant stills and the specimen's photographs", () => {
    expect(inPublic("/site/plant/plant-wide.webp")).toBe(true);
    expect(inPublic("/site/plant/plant-tall.webp")).toBe(true);
    for (const p of SPECIMEN.photos) {
      expect(inPublic(p.src), p.src).toBe(true);
      expect(p.poly.length).toBeGreaterThan(3);
      for (const [x, y] of p.poly) expect(x >= 0 && y >= 0 && x <= SPECIMEN.cropPx && y <= SPECIMEN.cropPx).toBe(true);
    }
  });

  it("has a playable hero list: at least one clip, each with its files", () => {
    expect(HERO_MEDIA.length).toBeGreaterThan(0);
    for (const c of HERO_MEDIA) {
      expect(inPublic(c.src), c.src).toBe(true);
      expect(inPublic(c.poster), c.poster).toBe(true);
      if (c.srcSmall) expect(inPublic(c.srcSmall), c.srcSmall).toBe(true);
    }
  });

  it("names no camera maker in a public file name", () => {
    expect(readdirSync(join(PUBLIC, "site", "plant")).filter(n => /dji/i.test(n))).toEqual([]);
  });
});

describe("the website's links", () => {
  it("lands every in-page link on a section that exists", () => {
    const anchors = [...NAV.map(n => n.href), "#beyond", "#top"];
    for (const a of anchors) expect(source, a).toMatch(new RegExp(`id="${a.slice(1)}"`));
  });

  it("sends Request access to the access form, which is routed", () => {
    expect(ACCESS_HREF).toBe("/apply");
    expect(readFileSync(join(ROOT, "src", "App.tsx"), "utf-8")).toMatch(/path="\/apply"/);
  });
});
