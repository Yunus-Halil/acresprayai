// Things that must hold for a pilot participant's ordinary day (found in the pre-launch check of the whole pilot):
// a Field Twin whose entry cannot be reached is not reported as deleted; reviews that could not be loaded are not
// treated as "no reviews" when the next one is saved; the founder's desk shows a build stage as text whatever a
// participant's browser sent; what one account's browser kept offline is not there for the next; and a folder left
// with only an analysis record is cleaned up, not listed as a twin.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// ---- the account, in memory ---------------------------------------------------------------------------------------
type Review = { finding_kind: string; finding_id: string; verdict: string; note: string | null; payload: unknown };
let reviews: Review[] = [];
let reviewReadFails = false;
let twinReadFails: string | null = null;
let twinRows: Record<string, unknown>[] = [];
const upserts: Record<string, unknown>[] = [];
const inserts: Record<string, unknown>[][] = [];
const objects = new Map<string, Blob>();
const removed: string[] = [];
let session: { user: { id: string } } | null = { user: { id: "alice" } };
const authListeners = new Set<(event: string, s: typeof session) => void>();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (cb: (event: string, s: typeof session) => void) => { authListeners.add(cb); return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } }; },
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => {
      if (table === "twin_reviews") {
        const read = () => (reviewReadFails ? { data: null, error: { message: "Failed to fetch" } } : { data: reviews, error: null });
        return {
          select: () => ({ eq: () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve(read()).then(ok) }) }),
          upsert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => { upserts.push(row); return { data: { ...row, id: "r", created_at: "", updated_at: "" }, error: null }; } }) }),
        };
      }
      // field_twins
      const q: Record<string, unknown> = {
        select: () => q, order: () => q,
        eq: () => ({ maybeSingle: async () => (twinReadFails ? { data: null, error: { message: twinReadFails } } : { data: null, error: null }) }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: twinRows, error: null }).then(ok),
        insert: (rows: Record<string, unknown>[]) => ({ select: async () => { inserts.push(rows); return { data: rows.map(r => ({ ...r, id: `rec-${r.storage_key}`, created_at: "2026-11-11T00:00:00Z", updated_at: "2026-11-11T00:00:00Z" })), error: null }; } }),
      };
      return q;
    },
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string) => {
          const under = [...objects.keys()].filter(k => k.startsWith(`${bucket}/${folder}/`)).map(k => k.slice(`${bucket}/${folder}/`.length));
          const names = [...new Set(under.map(n => n.split("/")[0]))];
          return { data: names.map(name => ({ name, id: under.includes(name) ? "file" : null, updated_at: null })), error: null };
        },
        remove: async (paths: string[]) => { for (const p of paths) { removed.push(p); objects.delete(`${bucket}/${p}`); } return { error: null }; },
      }),
    },
  },
}));
vi.mock("@/lib/pilot/telemetry", () => ({ track: () => undefined }));
vi.mock("@/lib/pilot/access", () => ({ usePilotRole: () => "participant", usePilot: () => ({ access: { status: "member", serverRole: "participant", role: "participant", displayName: null } }) }));
vi.mock("@/components/app/fieldTwin/FieldTwinView", () => ({ default: () => <div>the twin</div> }));
vi.mock("@/components/pilot/FeedbackDialog", () => ({ FeedbackButton: () => null }));

import { AuthProvider, dropAccountCaches, useAuth } from "@/lib/auth";
import { useTwinReviews } from "@/lib/fieldTwin/reviews";
import { listTwinRecords } from "@/lib/fieldTwin/registry";
import { BuildsSection } from "@/components/pilot/admin/sections";
import type { Snapshot } from "@/lib/pilot/adminData";
import TwinOpen from "@/pages/app/TwinOpen";

const deleted: string[] = [];
beforeEach(() => {
  reviews = []; reviewReadFails = false; twinReadFails = null; twinRows = []; upserts.length = 0; inserts.length = 0; objects.clear(); removed.length = 0;
  session = { user: { id: "alice" } }; authListeners.clear(); deleted.length = 0;
  (globalThis as unknown as { caches: unknown }).caches = { delete: async (name: string) => { deleted.push(name); return true; } };
});
afterEach(() => { cleanup(); });

describe("opening a Field Twin whose entry cannot be reached", () => {
  const open = () => render(
    <AuthProvider><MemoryRouter initialEntries={["/app/twins/3f2a9c1e-0000-4000-8000-000000000001"]}><Routes><Route path="/app/twins/:id" element={<TwinOpen />} /></Routes></MemoryRouter></AuthProvider>,
  );

  it("says the connection failed and offers to try again; it does not say the twin was deleted", async () => {
    twinReadFails = "TypeError: Failed to fetch";
    open();
    expect(await screen.findByText("The Field Twin could not be downloaded. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/does not exist in your account, or it was deleted/)).toBeNull();
  });

  it("a twin that really is not in the account is still reported as such", async () => {
    open();
    expect(await screen.findByText("This Field Twin does not exist in your account, or it was deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("reviews that could not be loaded", () => {
  const TWIN = "3f2a9c1e-0000-4000-8000-000000000001";
  const boundary: Review = { finding_kind: "boundary", finding_id: "field", verdict: "wrong", note: null, payload: { ring: [[1, 2], [3, 4], [5, 6]] } };

  it("are read again before a new one is written, so an earlier answer is not written over unseen", async () => {
    reviews = [boundary];
    reviewReadFails = true;
    const h = renderHook(() => useTwinReviews(TWIN));
    await waitFor(() => expect(h.result.current.error).toBe("Failed to fetch"));
    // The connection is back. "Looks right" on the boundary would have replaced the drawn correction with nothing.
    reviewReadFails = false;
    let message = "";
    await act(async () => { await h.result.current.save({ kind: "boundary", id: "field", verdict: "correct" }).catch(e => { message = (e as Error).message; }); });
    expect(message).toMatch(/You had already reviewed this finding/);
    expect(upserts).toEqual([]);
    // The earlier answer is now shown, and the participant can change it knowingly.
    expect(h.result.current.reviews?.get("boundary:field")).toMatchObject({ verdict: "wrong", payload: boundary.payload });
    expect(h.result.current.error).toBeNull();
    await act(async () => { await h.result.current.save({ kind: "boundary", id: "field", verdict: "correct" }); });
    expect(upserts).toHaveLength(1);
  });

  it("still unreachable: nothing is written, and the message says why", async () => {
    reviewReadFails = true;
    const h = renderHook(() => useTwinReviews(TWIN));
    await waitFor(() => expect(h.result.current.error).toBe("Failed to fetch"));
    let message = "";
    await act(async () => { await h.result.current.save({ kind: "corn_weed", id: 3, verdict: "wrong" }).catch(e => { message = (e as Error).message; }); });
    expect(message).toMatch(/Your earlier reviews could not be loaded, so this one was not saved/);
    expect(upserts).toEqual([]);
  });

  it("a finding with no earlier answer is saved once the reviews have been read", async () => {
    reviewReadFails = true;
    const h = renderHook(() => useTwinReviews(TWIN));
    await waitFor(() => expect(h.result.current.error).toBe("Failed to fetch"));
    reviewReadFails = false;
    await act(async () => { await h.result.current.save({ kind: "corn_weed", id: 3, verdict: "correct" }); });
    expect(upserts).toHaveLength(1);
  });

  it("reviews that loaded are saved as before", async () => {
    const h = renderHook(() => useTwinReviews(TWIN));
    await waitFor(() => expect(h.result.current.reviews).not.toBeNull());
    await act(async () => { await h.result.current.save({ kind: "corn_weed", id: 3, verdict: "correct" }); });
    expect(upserts).toHaveLength(1);
  });
});

describe("the founder's Builds tab", () => {
  it("shows a stage as text whatever name an event carried, including names every object has", () => {
    const at = new Date().toISOString();
    const event = (over: Record<string, unknown>) => ({ at, user_id: "p1", session_id: "s", route: null, twin_id: null, duration_ms: 1000, outcome: "ok", error: null, counts: { photographs: 40 }, stages: null, detail: null, app_version: "x", ...over });
    const snap = {
      generated_at: at, missing: {}, users: [], twins: [], consents: [], reviews: [], feedback: [], applications: [], access: [],
      members: [{ user_id: "p1", role: "participant", status: "active", email: "p1@farm.test", display_name: "Pat", organisation: null, application_id: null, invited_at: at, created_at: at, notes: null }],
      events: [
        event({ name: "twin_build_failed", outcome: "error", error: "boom", detail: JSON.parse('{"stage":"__proto__","crop":"corn"}') }),
        event({ name: "twin_build_failed", outcome: "error", error: "boom", detail: { stage: "constructor", crop: "corn" } }),
        event({ name: "twin_build_finished", stages: JSON.parse('{"__proto__":5,"toString":7,"photographs":1200}') }),
      ],
    } as unknown as Snapshot;
    render(<MemoryRouter><BuildsSection snap={snap} /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Reading photographs");
    expect(text).toContain("__proto__");
    expect(text).toContain("constructor");
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("function ");
  });
});

describe("what a browser kept offline for one account", () => {
  function Who() { const { user } = useAuth(); return <p>{user ? `signed in as ${user.id}` : "signed out"}</p>; }
  const fire = async (event: string, s: typeof session) => { session = s; await act(async () => { for (const cb of [...authListeners]) cb(event, s); }); };

  it("is dropped when the account signs out, and when another account signs in; a reload as the same account keeps it", async () => {
    render(<AuthProvider><Who /></AuthProvider>);
    expect(await screen.findByText("signed in as alice")).toBeInTheDocument();
    await fire("INITIAL_SESSION", { user: { id: "alice" } });
    await fire("TOKEN_REFRESHED", { user: { id: "alice" } });
    expect(deleted).toEqual([]);
    await fire("SIGNED_OUT", null);
    expect(deleted).toEqual(["supabase-rest"]);
    await fire("SIGNED_IN", { user: { id: "bob" } });
    expect(deleted).toEqual(["supabase-rest", "supabase-rest"]);
    expect(screen.getByText("signed in as bob")).toBeInTheDocument();
  });

  it("a browser without that storage is no error", async () => {
    delete (globalThis as unknown as { caches?: unknown }).caches;
    await expect(dropAccountCaches()).resolves.toBeUndefined();
  });

  it("the pilot's account tables are never kept offline at all: membership, agreement, twin list, reviews, access history, events", () => {
    const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
    const source = /urlPattern: (\/\^https:\\\/\\\/\[a-z0-9-\]\+\\\.supabase\\\.co\\\/rest\\\/v1\\\/\(\?![^\n]+\)\/),/.exec(config);
    expect(source).not.toBeNull();
    const pattern = new RegExp(source![1].slice(1, -1));
    const url = (table: string) => `https://iftkcpcwxnpbllyfadit.supabase.co/rest/v1/${table}?select=*`;
    for (const t of ["pilot_members", "pilot_consents", "pilot_feedback", "pilot_applications", "field_twins", "twin_reviews", "admin_access_log", "app_events"]) expect(pattern.test(url(t)), t).toBe(false);
    // The founder's workbench data keeps its offline fallback, as before.
    for (const t of ["fields", "scans", "flight_logs"]) expect(pattern.test(url(t)), t).toBe(true);
  });
});

describe("a folder left with only an analysis record (its twin was deleted while the record was on its way)", () => {
  const T = "3f2a9c1e-0000-4000-8000-00000000000a";
  it("is cleaned up the next time the account's twins are listed, and is not listed as a twin", async () => {
    objects.set(`orthos/alice/field-twins/${T}/analysis.json.gz`, new Blob(["record"]));
    const list = await listTwinRecords("alice");
    expect(list).toEqual([]);
    expect(removed).toEqual([`alice/field-twins/${T}/analysis.json.gz`]);
    expect(objects.size).toBe(0);
    expect(inserts).toEqual([]);
  });

  it("a folder that holds a twin, or part of one, is listed as before and nothing in it is removed", async () => {
    const whole = "3f2a9c1e-0000-4000-8000-00000000000b", part = "3f2a9c1e-0000-4000-8000-00000000000c";
    for (const f of ["twin.json.gz", "atlas-0.jpg", "analysis.json.gz"]) objects.set(`orthos/alice/field-twins/${whole}/${f}`, new Blob(["x"]));
    for (const f of ["atlas-0.jpg", "analysis.json.gz"]) objects.set(`orthos/alice/field-twins/${part}/${f}`, new Blob(["x"]));
    const list = await listTwinRecords("alice");
    expect(removed).toEqual([]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].map(r => [r.storage_key, r.status]).sort()).toEqual([[whole, "ready"], [part, "incomplete"]]);
    expect(list).toHaveLength(2);
  });
});
