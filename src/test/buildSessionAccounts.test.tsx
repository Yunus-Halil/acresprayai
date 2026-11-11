// The build session and the account it belongs to (src/lib/fieldTwin/buildSession.ts): a build this tab holds for one
// account is not shown, opened or saved under another; a finished build can be followed by a second one without
// reloading the page; and a save that keeps failing has a way out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };
const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); promise.catch(() => undefined); return { promise, resolve, reject }; };
let build: { done: Deferred<unknown>; cancel: ReturnType<typeof vi.fn> };
const startTwinBuild = vi.fn((_f: File[], _o: Record<string, unknown>) => ({ done: build.done.promise, cancel: build.cancel }));
vi.mock("@/lib/fieldTwin/build/runBuild", async orig => ({ ...(await orig<typeof import("@/lib/fieldTwin/build/runBuild")>()), startTwinBuild: (f: File[], o: Record<string, unknown>) => startTwinBuild(f, o) }));
let saveBuiltTwin = vi.fn(async (_user: string, twin: { id: string }) => ({ id: twin.id, storage_key: twin.id, name: "North", status: "ready" }));
vi.mock("@/lib/fieldTwin/registry", async orig => ({
  ...(await orig<typeof import("@/lib/fieldTwin/registry")>()),
  beginSave: async (twin: { id: string }) => ({ id: twin.id, storage_key: twin.id, name: "North", status: "saving" }),
  saveBuiltTwin: (...a: unknown[]) => (saveBuiltTwin as unknown as (...x: unknown[]) => unknown)(...a),
}));
const tracked: string[] = [];
vi.mock("@/lib/pilot/telemetry", () => ({ track: (name: string) => { tracked.push(name); } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "alice", email: "alice@farm.test" } }) }));
vi.mock("@/lib/pilot/access", () => ({ usePilotRole: () => "participant", usePilot: () => ({ access: { status: "member", serverRole: "participant", role: "participant", displayName: null } }) }));

import { __resetBuildSession, discardBuildSession, getBuildSession, onBuildSessionChange, releaseSessionOfOtherAccount, sessionBusy, sessionTwin, startBuildSession } from "@/lib/fieldTwin/buildSession";
import TwinNew from "@/pages/app/TwinNew";

const files = [new File(["a"], "DJI_0001.JPG"), new File(["b"], "DJI_0002.JPG")];
const result = (id: string) => ({
  twin: { id, name: "North", source: { photographs: 2, camera: "DJI FC6310R", capturedAt: null }, atlases: [] },
  files: new Map<string, Blob>(), report: { totalMs: 1000, timings: {}, photographs: { given: 2, read: 2, refused: [] } },
  atlases: Promise.resolve(new Map<string, Blob>()), progress: { done: 0, total: 0 }, onAtlas: () => undefined, analysis: null,
});
const flushAll = async () => { for (let k = 0; k < 8; k++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const start = (user = "alice") => { startBuildSession(files, { name: "North", crop: "corn", weeds: "colour", userId: user }); return (getBuildSession() as { id: string }).id; };

beforeEach(() => {
  __resetBuildSession(); tracked.length = 0;
  build = { done: deferred(), cancel: vi.fn() };
  saveBuiltTwin = vi.fn(async (_user: string, twin: { id: string }) => ({ id: twin.id, storage_key: twin.id, name: "North", status: "ready" }));
  startTwinBuild.mockClear();
});
afterEach(() => { cleanup(); __resetBuildSession(); });

describe("another account in the same tab", () => {
  it("a finished build held for one account is forgotten when another account has the app open: nothing of it can be opened", async () => {
    const id = start("alice");
    build.done.resolve(result(id)); await flushAll();
    expect(getBuildSession().status).toBe("saved");
    expect(sessionTwin(id)).not.toBeNull();
    releaseSessionOfOtherAccount("bob");
    expect(getBuildSession()).toEqual({ status: "idle" });
    expect(sessionTwin(id)).toBeNull();
  });

  it("a build still running for the other account is stopped, and its result is never saved", async () => {
    const id = start("alice");
    releaseSessionOfOtherAccount("bob");
    expect(build.cancel).toHaveBeenCalledTimes(1);
    expect(getBuildSession()).toEqual({ status: "idle" });
    // The worker answers after all: nothing is saved under anyone.
    build.done.resolve(result(id)); await flushAll();
    expect(saveBuiltTwin).not.toHaveBeenCalled();
    expect(getBuildSession()).toEqual({ status: "idle" });
  });

  it("the same account keeps its build: moving around the app, or the page asking again, changes nothing", async () => {
    const id = start("alice");
    releaseSessionOfOtherAccount("alice");
    expect(getBuildSession().status).toBe("building");
    expect(build.cancel).not.toHaveBeenCalled();
    build.done.resolve(result(id)); await flushAll();
    releaseSessionOfOtherAccount("alice");
    expect(getBuildSession().status).toBe("saved");
  });

  it("with no build in the tab there is nothing to do", () => {
    releaseSessionOfOtherAccount("bob");
    expect(getBuildSession()).toEqual({ status: "idle" });
  });
});

describe("a save that keeps failing", () => {
  it("can be given up: the tab is free again, and nothing else is written", async () => {
    saveBuiltTwin = vi.fn(async () => { throw new Error("storage is full"); });
    const id = start();
    build.done.resolve(result(id)); await flushAll();
    expect(getBuildSession()).toMatchObject({ status: "save-failed", error: "storage is full" });
    expect(sessionBusy()).toBe(true);
    discardBuildSession();
    expect(getBuildSession()).toEqual({ status: "idle" });
    expect(sessionBusy()).toBe(false);
    expect(saveBuiltTwin).toHaveBeenCalledTimes(1);
    expect(tracked.at(-1)).toBe("twin_build_cancelled");
  });

  it("only that: a build that is running, saving or saved is not thrown away by it", async () => {
    const id = start();
    discardBuildSession();
    expect(getBuildSession().status).toBe("building");
    build.done.resolve(result(id)); await flushAll();
    discardBuildSession();
    expect(getBuildSession().status).toBe("saved");
  });
});

describe("hearing the session change", () => {
  it("is told of every change until it stops listening", async () => {
    const heard = vi.fn();
    const stop = onBuildSessionChange(heard);
    const id = start();
    expect(heard).toHaveBeenCalled();
    heard.mockClear();
    stop();
    build.done.resolve(result(id)); await flushAll();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("the New Field Twin page after a build", () => {
  it("offers the twin and a second build, and the second build starts from an empty form without reloading", async () => {
    const id = start();
    build.done.resolve(result(id)); await flushAll();
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Open the Field Twin" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Build another Field Twin" }));
    expect(getBuildSession()).toEqual({ status: "idle" });
    expect(await screen.findByRole("button", { name: "Build the Field Twin" })).toBeInTheDocument();
  });

  it("while the twin is still saving there is no second build to start", async () => {
    saveBuiltTwin = vi.fn(() => new Promise<never>(() => undefined)) as never;
    const id = start();
    build.done.resolve(result(id)); await flushAll();
    expect(getBuildSession().status).toBe("saving");
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Build another Field Twin" })).toBeNull();
  });

  it("a save that keeps failing shows the way out, and taking it returns to the form", async () => {
    saveBuiltTwin = vi.fn(async () => { throw new Error("storage is full"); });
    const id = start();
    build.done.resolve(result(id)); await flushAll();
    render(<MemoryRouter><TwinNew /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Try saving again" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "give up on this build" }));
    expect(await screen.findByRole("button", { name: "Build the Field Twin" })).toBeInTheDocument();
  });
});
