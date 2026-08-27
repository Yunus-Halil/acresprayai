// House style: no em dashes in anything a user reads.
//
// The rule dates to the 2026-08-20 sweep ("Remove em dashes from everything a
// user reads", 06270ac) and went unenforced — every later session reintroduced
// them, and the original sweep itself left comma wreckage (", Select drone ,").
// This check makes the rule structural: any em dash in PRODUCT code outside a
// comment fails the suite, with file:line pointing at it. Code comments and
// test files are dev-facing and exempt; fix copy by REWORDING the sentence
// (a period, a colon, parentheses, or writing out "so"/"which means"), never
// by deleting the character and leaving the punctuation around it broken.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["src", join("supabase", "functions")];
const EXEMPT_DIRS = [join("src", "test")];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (EXEMPT_DIRS.some(e => relative(ROOT, p) === e)) continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip comments so the ban applies only to code (and thus to any string a
 *  user could ever see). Heuristic on purpose: block comments go first, then
 *  whole-line and whitespace-preceded trailing line comments — URLs ("://")
 *  survive because their slashes are not preceded by whitespace. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map(line => {
      const t = line.trimStart();
      if (t.startsWith("//")) return "";
      // No trailing $: carriage return is a JS-regex line terminator, so .*$
      // never matches on CRLF checkouts. Greedy .* stops at the CR anyway.
      return line.replace(/(\s)\/\/.*/, "$1");
    })
    .join("\n");
}

describe("no em dashes reach the operator", () => {
  it("product source carries none outside comments", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const cleaned = withoutComments(readFileSync(file, "utf-8"));
        cleaned.split("\n").forEach((line, i) => {
          if (line.includes("—")) {
            offenders.push(`${relative(ROOT, file).split(sep).join("/")}:${i + 1}  ${line.trim().slice(0, 100)}`);
          }
        });
      }
    }
    expect(
      offenders,
      "Em dash in user-facing source. Reword the sentence (period / colon / " +
      "parentheses / write the connective out) rather than swapping punctuation:\n" +
      offenders.join("\n"),
    ).toEqual([]);
  });
});
