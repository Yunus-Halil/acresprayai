// The participant's access history (Help, Your data choices): every time Swardus opened one of their Field Twins,
// with the reason given. It is a quiet, secondary section: closed until the participant opens it, read only then, with no
// alert, banner or badge. It stays reviewable, and a read that fails is never shown as "not opened".
//
// The rules it rests on are unchanged and tested where they live: a participant reads only their own rows
// (sql/pilotAccess.test.ts), opening needs the participant's permission and is logged first (edge/pilot-admin.test.ts).
// Added here: when the log cannot be written, the twin is not opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type Answer = { data: unknown; error: { message: string } | null };
const reads: { table: string; select: string; order: [string, unknown] | null; limit: number | null }[] = [];
let answer: () => Promise<Answer>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const read = { table, select: "", order: null as [string, unknown] | null, limit: null as number | null };
      const q = {
        select(cols: string) { read.select = cols; return q; },
        order(col: string, o: unknown) { read.order = [col, o]; return q; },
        limit(n: number) { read.limit = n; return q; },
        then(ok: (v: Answer) => unknown, bad?: (e: unknown) => unknown) { reads.push(read); return answer().then(ok, bad); },
      };
      return q;
    },
  },
}));

const consent = { terms_version: "pilot-2026-11-v2", troubleshooting_access: true, research_use: false, created_at: "2026-11-11T10:00:00Z" };
let loaded: typeof consent | null = consent;
vi.mock("@/lib/pilot/consent", async orig => ({
  ...(await orig<typeof import("@/lib/pilot/consent")>()),
  readConsent: async () => (loaded ? { status: "agreed", consent: loaded } : { status: "none" }),
  saveConsent: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "p1" } }) }));

import ConsentPage, { ConsentGate } from "@/components/pilot/ConsentScreen";
import { openTwin } from "../../supabase/functions/pilot-admin/monitor";

const ROWS = [
  { at: "2026-11-10T15:30:00Z", reason: "weeds by the gate looked wrong" },
  { at: "2026-11-09T09:05:00Z", reason: null },
];
const page = () => render(<MemoryRouter><ConsentPage /></MemoryRouter>);
const section = () => screen.findByRole("button", { name: /Access history/ });
const logReads = () => reads.filter(r => r.table === "admin_access_log");

beforeEach(() => { reads.length = 0; loaded = consent; answer = async () => ({ data: ROWS, error: null }); });
afterEach(() => { cleanup(); });

describe("Your data choices: access history", () => {
  it("is closed by default: a label and one line of explanation, nothing read, nothing announced", async () => {
    page();
    const button = await section();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveTextContent("See when Swardus opened your Field Twins.");
    // The choice still leads the page; the history is not a heading of its own any more.
    expect(screen.getByRole("heading", { name: "Your data choices" })).toBeInTheDocument();
    expect(screen.queryByText("When Swardus opened your Field Twins")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Access history/ })).toBeNull();
    // Nothing is read until it is asked for, and nothing draws the eye.
    await new Promise(r => setTimeout(r, 0));
    expect(logReads()).toHaveLength(0);
    expect(screen.queryByText(/weeds by the gate/)).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    for (const role of ["alert", "status", "alertdialog", "dialog"]) expect(screen.queryByRole(role)).toBeNull();
  });

  it("opened, it shows the participant's own records, newest first, with the reason given", async () => {
    page();
    const button = await section();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const items = await screen.findAllByRole("listitem");
    expect(items.map(li => li.textContent)).toEqual([
      `${new Date(ROWS[0].at).toLocaleString()}: weeds by the gate looked wrong`,
      new Date(ROWS[1].at).toLocaleString(),
    ]);
    // One read, of the dates and reasons only, newest first. Whose rows come back is the database's rule
    // ("see access to my data"): the page asks for no one by id.
    expect(logReads()).toEqual([{ table: "admin_access_log", select: "at, reason", order: ["at", { ascending: false }], limit: 100 }]);
    expect(document.getElementById(button.getAttribute("aria-controls")!)).toContainElement(items[0]);
  });

  it("closes again, and opening it a second time does not read again", async () => {
    page();
    const button = await section();
    fireEvent.click(button);
    await screen.findAllByRole("listitem");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(button);
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(logReads()).toHaveLength(1);
  });

  it("with no openings it says so plainly", async () => {
    answer = async () => ({ data: [], error: null });
    page();
    fireEvent.click(await section());
    expect(await screen.findByText("Your Field Twins have not been opened.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("a read that fails is never shown as 'not opened', and opening the section again retries", async () => {
    answer = async () => ({ data: null, error: { message: "permission denied" } });
    page();
    const button = await section();
    fireEvent.click(button);
    expect(await screen.findByText(/could not be read just now/)).toBeInTheDocument();
    expect(screen.queryByText("Your Field Twins have not been opened.")).toBeNull();
    // Offline is the same.
    answer = async () => { throw new Error("Failed to fetch"); };
    fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByText(/could not be read just now/)).toBeInTheDocument();
    expect(screen.queryByText("Your Field Twins have not been opened.")).toBeNull();
    // And once it can be read, it is.
    answer = async () => ({ data: ROWS, error: null });
    fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(logReads()).toHaveLength(3);
  });

  it("the participant's one choice is still there above it", async () => {
    page();
    await section();
    expect(await screen.findByRole("checkbox", { name: /Crops of my photographs, with my reviews of them, may also be used as examples/ })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save my choice" })).toBeInTheDocument();
  });

  it("the first-visit terms screen has no access history on it", async () => {
    loaded = null;
    render(<MemoryRouter><ConsentGate required><p>the app</p></ConsentGate></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Agree & Continue" })).toBeInTheDocument();
    expect(screen.queryByText(/Access history/)).toBeNull();
    await waitFor(() => expect(logReads()).toHaveLength(0));
  });
});

// ---- the rule the history rests on: no log entry, no opening ----------------------------------------------------
describe("pilot-admin openTwin: the audit entry comes first", () => {
  const TWIN = { id: "aaaaaaaa-1111-4000-8000-000000000001", user_id: "p1", storage_key: "north-2026", name: "North", status: "ready" };
  function admin(o: { allowed: boolean; logFails?: boolean }) {
    const log: unknown[] = [], signed: string[] = [], order: string[] = [];
    const table = (t: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: t === "field_twins" ? TWIN : t === "pilot_consents" ? { troubleshooting_access: o.allowed, created_at: "2026-11-09" } : null, error: null }),
        insert: (row: unknown) => {
          order.push("log");
          if (o.logFails) return Promise.resolve({ error: { message: "insert failed" } });
          log.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    };
    const storage = { from: () => ({
      list: async () => { order.push("list"); return { data: [{ name: "twin.json.gz", id: "1" }, { name: "atlas-0.jpg", id: "2" }], error: null }; },
      createSignedUrl: async (p: string) => { order.push("sign"); signed.push(p); return { data: { signedUrl: `https://signed.test/${p}` }, error: null }; },
    }) };
    return { client: { from: table, storage } as never, log, signed, order };
  }

  it("when the entry cannot be written, the twin is not opened: no file is listed or signed", async () => {
    const a = admin({ allowed: true, logFails: true });
    const res = await openTwin(a.client, "founder-1", TWIN.id, "looked wrong");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/signed\.test/);
    expect(a.signed).toEqual([]);
    expect(a.order).toEqual(["log"]);
  });

  it("without the participant's permission nothing is logged, listed or signed", async () => {
    const a = admin({ allowed: false });
    const res = await openTwin(a.client, "founder-1", TWIN.id, "looked wrong");
    expect(res.status).toBe(403);
    expect(a.order).toEqual([]);
  });

  it("with it, the entry is written before any file is handed over", async () => {
    const a = admin({ allowed: true });
    const res = await openTwin(a.client, "founder-1", TWIN.id, "looked wrong");
    expect(res.status).toBe(200);
    expect(a.log).toEqual([{ founder_id: "founder-1", participant_id: "p1", twin_id: TWIN.id, action: "open_twin", reason: "looked wrong" }]);
    expect(a.order).toEqual(["log", "list", "sign", "sign"]);
  });
});
