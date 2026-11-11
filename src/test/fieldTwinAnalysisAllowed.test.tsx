// Who gets an analysis record beside their corn Field Twins (src/lib/fieldTwin/analysisAccess.ts): the founder's own
// account; a participant only under approved terms that say what the record is and that they have agreed to. As
// shipped no version of the terms says so, so no participant gets one and none of their choices is read for it. And
// the app sends what waits on the device only for an account that gets a record, never during a build.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let access: { status: "loading" } | { status: "outside" } | { status: "member"; serverRole: "founder" | "participant"; role: "founder" | "participant"; displayName: null } = { status: "loading" };
vi.mock("@/lib/pilot/access", () => ({ usePilot: () => ({ access, preview: false, setPreview: () => undefined, reload: () => undefined }) }));
const loadConsent = vi.fn(async (): Promise<unknown> => null);
vi.mock("@/lib/pilot/consent", async orig => ({ ...(await orig<typeof import("@/lib/pilot/consent")>()), loadConsent: () => loadConsent() }));
const flushAnalysisOutbox = vi.fn(async (_user: string) => ({ sent: 0, kept: 0, dropped: 0 }));
const forgetAccountPending = vi.fn(async (_user: string) => undefined);
vi.mock("@/lib/fieldTwin/analysisOutbox", () => ({ flushAnalysisOutbox: (u: string) => flushAnalysisOutbox(u), forgetAccountPending: (u: string) => forgetAccountPending(u) }));
const authListeners = new Set<(event: string) => void>();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: (cb: (event: string) => void) => { authListeners.add(cb); return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } }; } } } }));
const authEvent = (event: string) => { for (const cb of [...authListeners]) cb(event); };
let busy = false;
vi.mock("@/lib/fieldTwin/buildSession", () => ({ sessionBusy: () => busy }));

import { analysisAllowed, openToParticipants, useAnalysisAllowed, useAnalysisOutbox } from "@/lib/fieldTwin/analysisAccess";
import { TERMS_DISCLOSING_ANALYSIS, TWIN_ANALYSIS_ENABLED } from "@/lib/fieldTwin/analysisConfig";
import { TERMS_APPROVED, TERMS_VERSION } from "@/lib/pilot/consent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const member = (serverRole: "founder" | "participant", role: "founder" | "participant" = serverRole) => ({ status: "member" as const, serverRole, role, displayName: null });
const V2 = { version: "pilot-v2", approved: true, disclosing: ["pilot-v2"] };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { access = { status: "loading" }; busy = false; loadConsent.mockReset(); loadConsent.mockResolvedValue(null); flushAnalysisOutbox.mockClear(); forgetAccountPending.mockClear(); authListeners.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe("as shipped", () => {
  it("the record is switched on, and the approved terms in force open it to the participants who agreed to them", () => {
    expect(TWIN_ANALYSIS_ENABLED).toBe(true);
    expect(TERMS_DISCLOSING_ANALYSIS).toEqual(["pilot-2026-11-v2"]);
    expect(TERMS_DISCLOSING_ANALYSIS).toContain(TERMS_VERSION);
    expect(analysisAllowed({ serverRole: "founder", agreedTerms: null })).toBe(true);
    expect(TERMS_APPROVED).toBe(true);
    expect(openToParticipants()).toBe(true);
    // As shipped: a participant who agreed to these terms gets one; one who agreed only to the earlier terms, or
    // whose agreement could not be read, does not.
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: TERMS_VERSION })).toBe(true);
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: "pilot-2026-11-v1" })).toBe(false);
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: null })).toBe(false);
    // Were the wording not approved, nobody but the founder would, whatever they agreed to.
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: TERMS_VERSION }, { version: TERMS_VERSION, approved: false, disclosing: TERMS_DISCLOSING_ANALYSIS })).toBe(false);
    const approved = { version: TERMS_VERSION, approved: true, disclosing: TERMS_DISCLOSING_ANALYSIS };
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: TERMS_VERSION }, approved)).toBe(true);
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: "pilot-2026-11-v1" }, approved)).toBe(false);
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: null }, approved)).toBe(false);
  });

  it("the terms page carries the record's section under that version: what it holds, that it holds no images, where a copy may wait", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/PilotTerms.tsx"), "utf8");
    expect(page).toContain("The analysis record of a corn Field Twin");
    expect(page).toContain("It holds no photographs and no image data.");
    expect(page).toMatch(/where the camera was at that moment \(latitude, longitude and height\)/);
    expect(page).toMatch(/a copy waits in your browser's storage on that device/);
    expect(page).toMatch(/after 7 days/);
  });
});

describe("the rule", () => {
  it("a participant gets the record only under approved terms that disclose it and that they agreed to", () => {
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: "pilot-v2" }, V2)).toBe(true);
    // Agreed to an earlier version, or to nothing that could be read.
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: "pilot-v1" }, V2)).toBe(false);
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: null }, V2)).toBe(false);
    // The wording exists but is not approved.
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: "pilot-v2" }, { ...V2, approved: false })).toBe(false);
    // The terms moved on to a version that does not carry the wording.
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: "pilot-v3" }, { version: "pilot-v3", approved: true, disclosing: ["pilot-v2"] })).toBe(false);
  });

  it("switched off, nobody gets one", () => {
    expect(analysisAllowed({ serverRole: "founder", agreedTerms: null }, V2, false)).toBe(false);
    expect(analysisAllowed({ serverRole: "participant", agreedTerms: "pilot-v2" }, V2, false)).toBe(false);
    expect(openToParticipants(V2, false)).toBe(false);
  });
});

describe("for the signed-in account", () => {
  it("nobody, until the membership is known; nobody outside the pilot", () => {
    expect(renderHook(() => useAnalysisAllowed()).result.current).toBe(false);
    access = { status: "outside" };
    expect(renderHook(() => useAnalysisAllowed()).result.current).toBe(false);
  });

  it("the founder: yes, also while previewing the participant experience, and no choices are read", async () => {
    access = member("founder");
    expect(renderHook(() => useAnalysisAllowed()).result.current).toBe(true);
    access = member("founder", "participant");
    expect(renderHook(() => useAnalysisAllowed()).result.current).toBe(true);
    await settle();
    expect(loadConsent).not.toHaveBeenCalled();
  });

  it("a participant, as shipped: yes once their agreement to the terms in force has been read; no if they agreed only to the earlier terms", async () => {
    access = member("participant");
    loadConsent.mockResolvedValue({ terms_version: TERMS_VERSION, troubleshooting_access: true, research_use: false, created_at: "2026-11-11T00:00:00Z" });
    const agreed = renderHook(() => useAnalysisAllowed());
    expect(agreed.result.current).toBe(false);
    await settle();
    expect(agreed.result.current).toBe(true);
    agreed.unmount();
    loadConsent.mockResolvedValue({ terms_version: "pilot-2026-11-v1", troubleshooting_access: true, research_use: true, created_at: "2026-11-09T00:00:00Z" });
    const earlier = renderHook(() => useAnalysisAllowed());
    await settle();
    expect(earlier.result.current).toBe(false);
  });

  it("under terms that do not describe the record, a participant's choices are not even read for it", async () => {
    access = member("participant");
    const h = renderHook(() => useAnalysisAllowed({ version: "pilot-v9", approved: true, disclosing: ["pilot-2026-11-v2"] }));
    await settle();
    expect(h.result.current).toBe(false);
    expect(loadConsent).not.toHaveBeenCalled();
  });

  it("a participant under terms that disclose the record: only once their agreement to those terms has been read", async () => {
    access = member("participant");
    loadConsent.mockResolvedValue({ terms_version: "pilot-v2", troubleshooting_access: false, research_use: false, created_at: "2026-12-01T00:00:00Z" });
    const h = renderHook(() => useAnalysisAllowed(V2));
    expect(h.result.current).toBe(false);
    await settle();
    expect(h.result.current).toBe(true);
  });

  it("a participant whose agreement is to an older version, cannot be read, or is not there: no", async () => {
    access = member("participant");
    for (const answer of [{ terms_version: "pilot-v1" }, null, "unavailable"]) {
      loadConsent.mockResolvedValue(answer);
      const h = renderHook(() => useAnalysisAllowed(V2));
      await settle();
      expect(h.result.current).toBe(false);
      h.unmount();
    }
    loadConsent.mockRejectedValue(new Error("offline"));
    const h = renderHook(() => useAnalysisAllowed(V2));
    await settle();
    expect(h.result.current).toBe(false);
  });
});

describe("sending what waits on the device", () => {
  it("the founder's app looks a little after it opens, and again when the connection comes back", () => {
    vi.useFakeTimers();
    access = member("founder");
    const h = renderHook(() => useAnalysisOutbox("founder-id"));
    expect(flushAnalysisOutbox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_000);
    expect(flushAnalysisOutbox).toHaveBeenCalledTimes(1);
    expect(flushAnalysisOutbox).toHaveBeenCalledWith("founder-id");
    window.dispatchEvent(new Event("online"));
    expect(flushAnalysisOutbox).toHaveBeenCalledTimes(2);
    // Gone with the app: nothing after sign-out.
    h.unmount();
    window.dispatchEvent(new Event("online"));
    expect(flushAnalysisOutbox).toHaveBeenCalledTimes(2);
  });

  it("not while a build is running or saving in this tab", () => {
    vi.useFakeTimers();
    access = member("founder");
    busy = true;
    renderHook(() => useAnalysisOutbox("founder-id"));
    vi.advanceTimersByTime(10_000);
    window.dispatchEvent(new Event("online"));
    expect(flushAnalysisOutbox).not.toHaveBeenCalled();
    busy = false;
    window.dispatchEvent(new Event("online"));
    expect(flushAnalysisOutbox).toHaveBeenCalledTimes(1);
  });

  it("signing out removes what still waits for that account on the device; nothing else does", () => {
    access = member("founder");
    const h = renderHook(() => useAnalysisOutbox("founder-id"));
    authEvent("TOKEN_REFRESHED"); authEvent("SIGNED_IN"); authEvent("USER_UPDATED");
    expect(forgetAccountPending).not.toHaveBeenCalled();
    authEvent("SIGNED_OUT");
    expect(forgetAccountPending).toHaveBeenCalledTimes(1);
    expect(forgetAccountPending).toHaveBeenCalledWith("founder-id");
    h.unmount();
    expect(authListeners.size).toBe(0);
  });

  it("never for a participant whose agreement to the terms in force has not been read, and never before the membership is known", () => {
    vi.useFakeTimers();
    access = member("participant");
    renderHook(() => useAnalysisOutbox("p1"));
    access = { status: "loading" };
    renderHook(() => useAnalysisOutbox("p2"));
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("online"));
    expect(flushAnalysisOutbox).not.toHaveBeenCalled();
  });
});
