// The public origin in every piece of SEO metadata is https://www.swardus.com. Link-preview crawlers read the served
// index.html without running JavaScript, so the template itself must be right; the per-route <Seo> component, robots.txt
// and the sitemap must agree with it. swathwise.com and swardus.com only redirect (Vercel domain settings).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Seo, { SITE } from "@/components/Seo";

const ORIGIN = "https://www.swardus.com";
const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/** The head facts a crawler reads, from an HTML string. */
function headOf(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const attr = (sel: string, a: string) => doc.querySelector(sel)?.getAttribute(a) ?? null;
  const ld = JSON.parse(doc.querySelector('script[type="application/ld+json"]')?.textContent ?? "null");
  return {
    canonical: attr('link[rel="canonical"]', "href"),
    ogUrl: attr('meta[property="og:url"]', "content"),
    ogImage: attr('meta[property="og:image"]', "content"),
    twitterImage: attr('meta[name="twitter:image"]', "content"),
    ld,
  };
}

function expectSwardusHead(html: string) {
  expect(html).not.toMatch(/swathwise\.com/i);
  const h = headOf(html);
  expect(h.canonical).toBe(`${ORIGIN}/`);
  expect(h.ogUrl).toBe(`${ORIGIN}/`);
  expect(h.ogImage).toBe(`${ORIGIN}/share-card.png`);
  expect(h.twitterImage).toBe(`${ORIGIN}/share-card.png`);
  expect(h.ld).toMatchObject({ "@type": "Organization", name: "Swardus", url: `${ORIGIN}/`, logo: `${ORIGIN}/favicon.png` });
}

describe("SEO metadata names www.swardus.com", () => {
  it("in the index.html template", () => {
    expectSwardusHead(read("index.html"));
  });

  it("points only at files that exist in public/", () => {
    for (const f of ["share-card.png", "favicon.png"]) expect(existsSync(path.join(root, "public", f))).toBe(true);
  });

  it("in the per-route <Seo> component: canonical and og:url", () => {
    expect(SITE).toBe(ORIGIN);
    render(<Seo title="Apply" path="/apply" />);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`${ORIGIN}/apply`);
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(`${ORIGIN}/apply`);
  });

  it("in robots.txt and the sitemap", () => {
    const robots = read("public/robots.txt"), sitemap = read("public/sitemap.xml");
    expect(robots).not.toMatch(/swathwise\.com/i);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(sitemap).not.toMatch(/swathwise\.com/i);
    expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])).toEqual([`${ORIGIN}/`, `${ORIGIN}/apply`]);
  });

  // The production HTML, when a build is present (npm run build): what Vercel actually serves.
  it.skipIf(!existsSync(path.join(root, "dist/index.html")))("in the built dist/index.html", () => {
    expectSwardusHead(read("dist/index.html"));
    expect(read("dist/robots.txt")).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});
