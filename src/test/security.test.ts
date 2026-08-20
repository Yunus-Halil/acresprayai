// Security regressions.
//
// These pin two classes of fix from the audit. Neither is exotic: both are the
// kind of thing that quietly comes back when somebody adds a field to a popup
// or tidies a config file, which is exactly why they are tests and not notes.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { escapeHtml, safeLabel } from "@/components/app/workspace/layers";

/** Payloads that actually fire, not just angle brackets. */
const PAYLOADS = [
  `<script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `"><svg/onload=alert(1)>`,
  `'"><iframe src=javascript:alert(1)>`,
  `</textarea><script>fetch('//evil')</script>`,
];

describe("map labels escape stored HTML", () => {
  // Leaflet renders a STRING passed to bindTooltip/bindPopup as HTML. A field
  // named `<img onerror=...>` therefore executed on render before this fix.
  it("neutralises every payload", () => {
    for (const p of PAYLOADS) {
      const out = safeLabel(p);
      expect(out).not.toContain("<script");
      expect(out).not.toContain("<img");
      expect(out).not.toContain("<svg");
      expect(out).not.toContain("<iframe");
      // The angle brackets must be entities, not stripped — stripping would
      // silently rewrite a legitimate name like "N<S strip".
      expect(out).toContain("&lt;");
    }
  });

  it("closes the attribute-breakout route as well as the tag route", () => {
    // Values land inside `data-x="..."` and inside style attributes, so a bare
    // quote is as dangerous as a bare bracket.
    const out = safeLabel(`" onmouseover="alert(1)`);
    expect(out).not.toContain(`"`);
    expect(out).toContain("&quot;");
    expect(safeLabel("it's")).toContain("&#39;");
  });

  it("leaves ordinary field names readable", () => {
    // Escaping that mangles "North Field #2 & Co." would get itself reverted.
    expect(safeLabel("North Field #2")).toBe("North Field #2");
    expect(safeLabel("Smith & Sons")).toBe("Smith &amp; Sons");
  });

  it("survives null and undefined instead of printing them", () => {
    // A missing issue tag reaching a tooltip must not render "undefined".
    expect(safeLabel(null)).toBe("");
    expect(safeLabel(undefined)).toBe("");
  });

  it("escapeHtml and safeLabel agree for strings", () => {
    for (const p of PAYLOADS) expect(safeLabel(p)).toBe(escapeHtml(p));
  });
});

describe("security headers ship with the deploy", () => {
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8"));
  const all = cfg.headers?.[0]?.headers ?? [];
  const header = (k: string): string | undefined =>
    all.find((h: { key: string; value: string }) => h.key.toLowerCase() === k.toLowerCase())?.value;

  it("refuses to be framed, in both the old header and the modern one", () => {
    // Clickjacking matters here beyond the usual: framed and overlaid, a
    // mis-aimed click lands on "Clear all treatment grid zones" or a boundary
    // edit — destructive actions on somebody's season of work.
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("keeps the enforced CSP to directives that cannot break the map", () => {
    // The resource policy ships Report-Only until it has been checked against
    // a real browser session. Enforcing script-src/img-src blind would take
    // the basemap or the app itself down.
    const enforced = header("Content-Security-Policy") ?? "";
    expect(enforced).not.toContain("script-src");
    expect(enforced).not.toContain("img-src");
    expect(header("Content-Security-Policy-Report-Only")).toContain("script-src 'self'");
  });

  it("allows every origin the app genuinely needs, in the report-only policy", () => {
    // If one of these is dropped, promoting the policy to enforced later
    // breaks the map — better to catch it here than in the field.
    const ro = header("Content-Security-Policy-Report-Only") ?? "";
    for (const origin of [
      "https://*.supabase.co",
      "https://server.arcgisonline.com",
      "https://*.tile.openstreetmap.org",
      "https://fonts.gstatic.com",
      "https://unpkg.com",
    ]) {
      expect(ro).toContain(origin);
    }
    expect(ro).toContain("media-src 'self'");     // the hero/cockpit video
  });

  it("sets nosniff, a referrer policy and locks down device APIs", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const perms = header("Permissions-Policy") ?? "";
    expect(perms).toContain("camera=()");
    expect(perms).toContain("microphone=()");
  });

  it("still rewrites every route to the SPA shell", () => {
    // Adding headers must not have displaced the rewrite that makes routing
    // work at all.
    expect(cfg.rewrites?.[0]?.destination).toBe("/index.html");
  });
});
