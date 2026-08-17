// The RLS contract for pilot_applications, asserted against the migration.
//
// This table is the most personal data in the schema - a farmer's name, email,
// phone and land. The protection is that no role has a readable SELECT policy,
// so PostgREST returns nothing to anybody and reads have to go through the
// admin-gated edge function.
//
// That protection is one `CREATE POLICY` away from being undone by a future
// migration, and nothing in the application code would fail if it were. So the
// guard is here: the policy text itself is the thing under test.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  resolve(here, "../../supabase/migrations/20260817160000_pilot_applications.sql"),
  "utf8",
);

/** Policy bodies, keyed by name, so assertions can look inside one policy. */
function policies(text: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /CREATE POLICY\s+"([^"]+)"\s+ON\s+public\.pilot_applications([\s\S]*?);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ name: m[1], body: m[2] });
  return out;
}

const all = policies(sql);
const selectPolicies = all.filter(p => /FOR\s+SELECT/i.test(p.body));
const insertPolicies = all.filter(p => /FOR\s+INSERT/i.test(p.body));

describe("pilot_applications · row level security", () => {
  it("has RLS enabled", () => {
    expect(sql).toMatch(/ALTER TABLE public\.pilot_applications ENABLE ROW LEVEL SECURITY/i);
  });

  it("grants no readable SELECT policy to any role", () => {
    // A submission must not be retrievable through the public API by anyone,
    // including a signed-in customer of the product.
    expect(selectPolicies.length).toBeGreaterThan(0);
    for (const policy of selectPolicies) {
      expect(policy.body, `policy "${policy.name}" must deny`).toMatch(/USING\s*\(\s*false\s*\)/i);
    }
  });

  it("denies SELECT explicitly for both anon and authenticated", () => {
    const roles = selectPolicies.flatMap(p => (p.body.match(/TO\s+([\w,\s]+?)\s+USING/i)?.[1] ?? "").split(","));
    const named = roles.map(r => r.trim().toLowerCase()).filter(Boolean);
    expect(named).toContain("anon");
    expect(named).toContain("authenticated");
  });

  it("lets anonymous submitters insert, and only insert", () => {
    expect(insertPolicies).toHaveLength(1);
    expect(insertPolicies[0].body).toMatch(/TO\s+anon/i);
    expect(all.some(p => /FOR\s+(UPDATE|DELETE|ALL)/i.test(p.body))).toBe(false);
  });

  it("validates in the insert policy rather than trusting the client", () => {
    // Same move migration 20260629155456 made for pilot_signups: replace
    // WITH CHECK (true) with a check that actually constrains the row.
    const check = insertPolicies[0].body;
    expect(check).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
    expect(check).toMatch(/email\s*~\*/i);
    expect(check).toMatch(/length\(full_name\)/i);
  });

  it("cannot store a drone model without a spray drone", () => {
    expect(sql).toMatch(/drone_model IS NULL OR drone_status = 'Have a spray drone'/i);
  });
});
