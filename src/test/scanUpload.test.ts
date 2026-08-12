// Integration tests for the resumable upload path.
//
// This is the code a farmer on a metered rural connection depends on. The
// behaviour that matters is not "does it upload" but "what does it cost when the
// connection drops" — so these tests are mostly about interruption, resumption,
// and not re-sending bytes that already landed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- module mocks -----------------------------------------------------------
// prepareForODM decodes images with canvas APIs jsdom does not implement, and
// its EXIF behaviour is not what is under test here.
vi.mock("@/lib/imagePrep", () => ({
  prepareForODM: vi.fn(async (f: File) => f),
  hasGPS: vi.fn(async () => true),
}));

// vi.mock is hoisted above ordinary consts, so the spies have to be created
// inside vi.hoisted to exist by the time the factory runs.
const { refreshSession, getSession } = vi.hoisted(() => ({
  refreshSession: vi.fn(async () => ({ data: {}, error: null })),
  getSession: vi.fn(async () => ({
    data: { session: { access_token: "jwt-token", user: { id: "user-1" } } },
  })),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { refreshSession, getSession } },
}));

import {
  MAX_IMAGES, MIN_IMAGES, UploadError,
  clearCheckpoint, readCheckpoint, uploadScan,
} from "@/lib/scanUpload";

// --- helpers ----------------------------------------------------------------

const FIELD = "field-1";

function makeFiles(n: number, prefix = "IMG"): File[] {
  return Array.from({ length: n }, (_, i) => {
    const f = new File([new Uint8Array([i])], `${prefix}_${i}.jpg`, { type: "image/jpeg" });
    // lastModified participates in the checkpoint key, so pin it.
    Object.defineProperty(f, "lastModified", { value: 1_700_000_000_000 + i });
    return f;
  });
}

type Scenario = {
  /** File names that should fail, and how. */
  fail?: Map<string, { status: number; body?: unknown }>;
  /** Names the "node" has accepted. */
  accepted: Set<string>;
  initCalls: number;
  commitCalls: number;
  uploadAttempts: string[];
};

function installFetch(s: Scenario) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const action = (init?.headers as Record<string, string>)?.["x-action"];
    if (action === "init") {
      s.initCalls++;
      return new Response(JSON.stringify({ task_id: "task-1", odm_uuid: "uuid-1" }), { status: 200 });
    }
    if (action === "commit") {
      s.commitCalls++;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    // upload
    const body = init?.body as FormData;
    const file = body.get("images") as File;
    s.uploadAttempts.push(file.name);
    const failure = s.fail?.get(file.name);
    if (failure) {
      return new Response(JSON.stringify(failure.body ?? { error: "boom" }), { status: failure.status });
    }
    s.accepted.add(file.name);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function scenario(over: Partial<Scenario> = {}): Scenario {
  return { accepted: new Set(), initCalls: 0, commitCalls: 0, uploadAttempts: [], ...over };
}

const noop = () => {};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Backoff sleeps would make the retry tests slow; collapse them.
  vi.spyOn(global.Math, "random").mockReturnValue(0);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------

describe("uploadScan · happy path", () => {
  it("uploads every image once and commits", async () => {
    const s = scenario();
    installFetch(s);
    const files = makeFiles(6);

    const result = await uploadScan({ fieldId: FIELD, files, onProgress: noop });

    expect(result).toEqual({ taskId: "task-1", odmUuid: "uuid-1" });
    expect(s.accepted.size).toBe(6);
    expect(s.uploadAttempts).toHaveLength(6);
    expect(s.commitCalls).toBe(1);
  });

  it("clears the checkpoint on success, so the next scan starts clean", async () => {
    installFetch(scenario());
    await uploadScan({ fieldId: FIELD, files: makeFiles(5), onProgress: noop });

    expect(readCheckpoint(FIELD)).toBeNull();
  });

  it("reports progress through to done", async () => {
    installFetch(scenario());
    const phases: string[] = [];
    await uploadScan({
      fieldId: FIELD, files: makeFiles(5),
      onProgress: (p) => phases.push(p.phase),
    });

    expect(phases).toContain("uploading");
    expect(phases).toContain("committing");
    expect(phases[phases.length - 1]).toBe("done");
  });
});

describe("uploadScan · a single bad image does not destroy the batch", () => {
  it("keeps uploading around a failing image and reports it at the end", async () => {
    const s = scenario({ fail: new Map([["IMG_3.jpg", { status: 500 }]]) });
    installFetch(s);
    const files = makeFiles(8);

    await expect(uploadScan({ fieldId: FIELD, files, onProgress: noop }))
      .rejects.toThrow(/1 of 8 images/);

    // The other seven still landed - the run did not abort at the failure.
    expect(s.accepted.size).toBe(7);
    // ...and it was retried rather than given up on immediately.
    expect(s.uploadAttempts.filter(n => n === "IMG_3.jpg").length).toBeGreaterThan(1);
    // Nothing is committed while images are missing.
    expect(s.commitCalls).toBe(0);
  });

  it("surfaces the failure as resumable", async () => {
    installFetch(scenario({ fail: new Map([["IMG_2.jpg", { status: 500 }]]) }));

    const err = await uploadScan({ fieldId: FIELD, files: makeFiles(5), onProgress: noop })
      .catch(e => e);

    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).resumable).toBe(true);
    expect(err.message).toMatch(/progress is saved/i);
  });

  it("retries a transient failure and succeeds without farmer intervention", async () => {
    const s = scenario();
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const action = (init?.headers as Record<string, string>)?.["x-action"];
      if (action === "init") return new Response(JSON.stringify({ task_id: "t", odm_uuid: "u" }));
      if (action === "commit") return new Response(JSON.stringify({ ok: true }));
      const file = (init?.body as FormData).get("images") as File;
      if (file.name === "IMG_1.jpg" && attempts++ < 2) {
        return new Response(JSON.stringify({ error: "flaky" }), { status: 503 });
      }
      s.accepted.add(file.name);
      return new Response(JSON.stringify({ ok: true }));
    }));

    await uploadScan({ fieldId: FIELD, files: makeFiles(5), onProgress: noop });

    expect(s.accepted.size).toBe(5);
  });
});

describe("uploadScan · resume", () => {
  it("re-sends only the images the node has not accepted", async () => {
    const files = makeFiles(10);

    // First run: one image fails, nine land.
    const first = scenario({ fail: new Map([["IMG_7.jpg", { status: 500 }]]) });
    installFetch(first);
    await uploadScan({ fieldId: FIELD, files, onProgress: noop }).catch(() => {});
    expect(first.accepted.size).toBe(9);

    // The checkpoint survives.
    const ckpt = readCheckpoint(FIELD);
    expect(ckpt?.done).toHaveLength(9);

    // Second run: everything succeeds.
    const second = scenario();
    installFetch(second);
    await uploadScan({ fieldId: FIELD, files, onProgress: noop });

    // Only the missing image is re-sent. This is the whole point: on a metered
    // connection, resuming must not re-spend the data already paid for.
    expect(second.uploadAttempts).toEqual(["IMG_7.jpg"]);
    // And it resumed the same ODM task rather than starting a new one.
    expect(second.initCalls).toBe(0);
    expect(second.commitCalls).toBe(1);
  });

  it("keys the checkpoint on name, size and modified time", async () => {
    const files = makeFiles(6);
    installFetch(scenario({ fail: new Map([["IMG_5.jpg", { status: 500 }]]) }));
    await uploadScan({ fieldId: FIELD, files, onProgress: noop }).catch(() => {});

    const ckpt = readCheckpoint(FIELD)!;
    for (const key of ckpt.done) {
      expect(key).toMatch(/^IMG_\d+\.jpg:\d+:\d+$/);
    }

    // A different file with the same name is NOT treated as already uploaded.
    const impostor = new File([new Uint8Array([9, 9, 9])], "IMG_0.jpg", { type: "image/jpeg" });
    Object.defineProperty(impostor, "lastModified", { value: 999 });
    const swapped = [impostor, ...files.slice(1)];

    const second = scenario();
    installFetch(second);
    await uploadScan({ fieldId: FIELD, files: swapped, onProgress: noop });

    expect(second.uploadAttempts).toContain("IMG_0.jpg");
  });

  it("starts fresh when the selection size no longer matches the checkpoint", async () => {
    installFetch(scenario({ fail: new Map([["IMG_4.jpg", { status: 500 }]]) }));
    await uploadScan({ fieldId: FIELD, files: makeFiles(6), onProgress: noop }).catch(() => {});
    expect(readCheckpoint(FIELD)).not.toBeNull();

    // A different number of files means a different scan.
    const second = scenario();
    installFetch(second);
    await uploadScan({ fieldId: FIELD, files: makeFiles(8), onProgress: noop });

    expect(second.initCalls).toBe(1);
    expect(second.uploadAttempts).toHaveLength(8);
  });

  it("discards a checkpoint older than a day", async () => {
    installFetch(scenario({ fail: new Map([["IMG_4.jpg", { status: 500 }]]) }));
    await uploadScan({ fieldId: FIELD, files: makeFiles(6), onProgress: noop }).catch(() => {});

    const raw = JSON.parse(localStorage.getItem(`acrespray.upload.${FIELD}`)!);
    raw.savedAt = Date.now() - 2 * 86_400_000;
    localStorage.setItem(`acrespray.upload.${FIELD}`, JSON.stringify(raw));

    expect(readCheckpoint(FIELD)).toBeNull();
  });

  it("clearCheckpoint forgets saved progress", async () => {
    installFetch(scenario({ fail: new Map([["IMG_4.jpg", { status: 500 }]]) }));
    await uploadScan({ fieldId: FIELD, files: makeFiles(6), onProgress: noop }).catch(() => {});
    expect(readCheckpoint(FIELD)).not.toBeNull();

    clearCheckpoint(FIELD);
    expect(readCheckpoint(FIELD)).toBeNull();
  });
});

describe("uploadScan · permanent rejection", () => {
  it("aborts immediately on a max_images 413 instead of burning the rest of the batch", async () => {
    const s = scenario({
      fail: new Map([["IMG_2.jpg", { status: 413, body: { error: "max images", code: "max_images" } }]]),
    });
    installFetch(s);

    const err = await uploadScan({ fieldId: FIELD, files: makeFiles(50), onProgress: noop })
      .catch(e => e);

    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).resumable).toBe(false);
    expect(err.message).toMatch(/too many images/i);

    // The node will reject every subsequent image identically, so retrying 47
    // more times would waste the farmer's data for nothing.
    expect(s.uploadAttempts.filter(n => n === "IMG_2.jpg")).toHaveLength(1);
    expect(s.uploadAttempts.length).toBeLessThan(10);
    // A permanent rejection also clears the checkpoint - resuming is pointless.
    expect(readCheckpoint(FIELD)).toBeNull();
  });

  it("does not retry a 4xx rejection of a single image", async () => {
    const s = scenario({
      fail: new Map([["IMG_1.jpg", { status: 422, body: { error: "corrupt jpeg" } }]]),
    });
    installFetch(s);

    await uploadScan({ fieldId: FIELD, files: makeFiles(5), onProgress: noop }).catch(() => {});

    // A corrupt file will be corrupt on every attempt.
    expect(s.uploadAttempts.filter(n => n === "IMG_1.jpg")).toHaveLength(1);
    // ...but the rest of the batch still goes.
    expect(s.accepted.size).toBe(4);
  });

  it("fails the run when init is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "field not found" }), { status: 404 })));

    const err = await uploadScan({ fieldId: FIELD, files: makeFiles(5), onProgress: noop })
      .catch(e => e);

    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).resumable).toBe(false);
  });

  it("keeps the checkpoint when commit fails, so images are not re-sent", async () => {
    const s = scenario();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const action = (init?.headers as Record<string, string>)?.["x-action"];
      if (action === "init") return new Response(JSON.stringify({ task_id: "t", odm_uuid: "u" }));
      if (action === "commit") return new Response(JSON.stringify({ error: "node busy" }), { status: 502 });
      s.accepted.add(((init?.body as FormData).get("images") as File).name);
      return new Response(JSON.stringify({ ok: true }));
    }));

    const err = await uploadScan({ fieldId: FIELD, files: makeFiles(5), onProgress: noop })
      .catch(e => e);

    expect((err as UploadError).resumable).toBe(true);
    expect(err.message).toMatch(/images are uploaded/i);
    expect(readCheckpoint(FIELD)?.done).toHaveLength(5);
  });
});

describe("uploadScan · pause", () => {
  it("stops on abort and keeps everything already accepted", async () => {
    const controller = new AbortController();
    const s = scenario();
    let sent = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const action = (init?.headers as Record<string, string>)?.["x-action"];
      if (action === "init") return new Response(JSON.stringify({ task_id: "t", odm_uuid: "u" }));
      if (action === "commit") { s.commitCalls++; return new Response(JSON.stringify({ ok: true })); }
      if (++sent === 4) controller.abort();
      s.accepted.add(((init?.body as FormData).get("images") as File).name);
      return new Response(JSON.stringify({ ok: true }));
    }));

    const err = await uploadScan({
      fieldId: FIELD, files: makeFiles(20), onProgress: noop, signal: controller.signal,
    }).catch(e => e);

    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).resumable).toBe(true);
    expect(err.message).toMatch(/paused/i);
    // Nowhere near all 20 were sent, and nothing was committed.
    expect(s.accepted.size).toBeLessThan(20);
    expect(s.commitCalls).toBe(0);
    // Progress survives for the resume.
    expect(readCheckpoint(FIELD)!.done.length).toBe(s.accepted.size);
  });

  it("a paused batch resumes without re-sending accepted images", async () => {
    const files = makeFiles(12);
    const controller = new AbortController();
    const first = scenario();
    let sent = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const action = (init?.headers as Record<string, string>)?.["x-action"];
      if (action === "init") return new Response(JSON.stringify({ task_id: "t", odm_uuid: "u" }));
      if (action === "commit") return new Response(JSON.stringify({ ok: true }));
      if (++sent === 3) controller.abort();
      first.accepted.add(((init?.body as FormData).get("images") as File).name);
      return new Response(JSON.stringify({ ok: true }));
    }));
    await uploadScan({ fieldId: FIELD, files, onProgress: noop, signal: controller.signal }).catch(() => {});
    const doneFirst = first.accepted.size;

    const second = scenario();
    installFetch(second);
    await uploadScan({ fieldId: FIELD, files, onProgress: noop });

    expect(second.uploadAttempts).toHaveLength(12 - doneFirst);
    expect(second.commitCalls).toBe(1);
  });
});

describe("uploadScan · batch bounds", () => {
  it("exposes the node's limits as constants the UI can enforce", () => {
    expect(MIN_IMAGES).toBe(5);
    expect(MAX_IMAGES).toBe(200);
  });
});
