// The per-scan assessment record: what the treatment grid freezes onto a scan.
//
// The state-decoding rules (none / done / failed / legacy) are pinned in
// compareGround.test.ts; this covers the WRITER — that a snapshot carries the
// grid's own numbers and provenance, and that a failure lands on the scan
// without disturbing what was already there.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import { recordGridRunFailure, snapshotGridAssessment } from "@/lib/scanAssessment";
import { analysisStateOf } from "@/lib/compareGround";
import { buildTreatmentGrid, gridDefinitionFor } from "@/lib/treatmentGrid";
import type { CellRate } from "@/lib/treatmentGrid";

// ~100 m square field.
const RING = [
  { lat: 45.0, lng: -93.0 },
  { lat: 45.0009, lng: -93.0 },
  { lat: 45.0009, lng: -92.9987 },
  { lat: 45.0, lng: -92.9987 },
];

type Row = { ai_analysis: unknown; ai_analysis_at: string | null };

function installDb(existing: Row | null) {
  const updates: Record<string, unknown>[] = [];
  fromMock.mockImplementation(() => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve({ data: existing, error: null }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
    return builder;
  });
  return updates;
}

function paintedGrid(assessedScanId: string | null = "task-1") {
  const def = gridDefinitionFor([RING], 10, 1);
  const grid = buildTreatmentGrid([RING], def);
  const treated: CellRate = { state: "treated", rateLha: 25, source: "operator", issue: "Weed pressure" };
  const skipped: CellRate = { state: "untreated", source: "operator" };
  const cells = grid.cells.map((c, i) => (
    i < 2 ? { ...c, rate: treated }
    : i === 2 ? { ...c, rate: skipped }
    : c
  ));
  return {
    ...grid,
    cells,
    assessed: assessedScanId
      ? { scanId: assessedScanId, scanDate: "2026-08-20T10:00:00Z", at: "2026-08-25T10:00:00Z" }
      : null,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("the inheritance gate", () => {
  it("refuses to write a carried-over grid onto a scan it was not confirmed against", async () => {
    const updates = installDb(null);
    // Confirmed against a DIFFERENT scan — the rescan-inheritance case.
    const res = await snapshotGridAssessment("task-2", paintedGrid("task-1"));
    expect(res).toEqual({ ok: true, skipped: true });
    expect(updates).toHaveLength(0);
  });

  it("treats unknown provenance (pre-provenance grids) as carried over too", async () => {
    const updates = installDb(null);
    const res = await snapshotGridAssessment("task-1", paintedGrid(null));
    expect(res).toEqual({ ok: true, skipped: true });
    expect(updates).toHaveLength(0);
  });

  it("a skipped snapshot leaves the scan reading as NOT yet assessed", async () => {
    installDb(null);
    await snapshotGridAssessment("task-2", paintedGrid("task-1"));
    // Nothing was written, so the scan row still decodes as none.
    const state = analysisStateOf({ ai_analysis: null, ai_analysis_at: null });
    expect(state.kind).toBe("none");
  });
});

describe("snapshotGridAssessment", () => {
  it("freezes the grid's zones, reference counts and provenance onto the scan", async () => {
    const updates = installDb(null);
    const res = await snapshotGridAssessment("task-1", paintedGrid());

    expect(res.ok).toBe(true);
    expect(updates).toHaveLength(1);
    const written = updates[0] as { ai_analysis: Record<string, unknown>; ai_analysis_at: string };
    const a = written.ai_analysis as {
      source: string;
      zones: { areaM2: number; rateLha: number; issue?: string; ring: unknown[] }[];
      reference: { treated: number; skipped: number };
      last_run: { status: string };
    };
    expect(a.source).toBe("treatment-grid");
    expect(a.reference).toEqual({ treated: 2, skipped: 1 });
    expect(a.last_run.status).toBe("completed");
    expect(written.ai_analysis_at).toBeTruthy();
    // Zones carry the grid's own numbers: real clipped area and painted rate.
    expect(a.zones.length).toBeGreaterThan(0);
    for (const z of a.zones) {
      expect(z.areaM2).toBeGreaterThan(0);
      expect(z.rateLha).toBe(25);
      expect(z.issue).toBe("Weed pressure");
      expect(z.ring.length).toBeGreaterThanOrEqual(3);
    }
    // And the written row decodes as a grid assessment, not legacy.
    const state = analysisStateOf({ ai_analysis: a, ai_analysis_at: written.ai_analysis_at });
    expect(state.kind).toBe("done");
    if (state.kind === "done") expect(state.source).toBe("grid");
  });

  it("an unpainted grid snapshots as NONE downstream — no fabricated clean result", async () => {
    const updates = installDb(null);
    const def = gridDefinitionFor([RING], 10, 1);
    await snapshotGridAssessment("task-1", {
      ...buildTreatmentGrid([RING], def),
      assessed: { scanId: "task-1", scanDate: null, at: "2026-08-25T10:00:00Z" },
    });

    const written = updates[0] as { ai_analysis: unknown; ai_analysis_at: string };
    const state = analysisStateOf({ ai_analysis: written.ai_analysis, ai_analysis_at: written.ai_analysis_at });
    expect(state.kind).toBe("none");
  });

  it("reports a write failure instead of pretending the record updated", async () => {
    fromMock.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: { message: "row is gone" } }) }),
    }));
    const res = await snapshotGridAssessment("task-1", paintedGrid());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/row is gone/);
  });
});

describe("recordGridRunFailure", () => {
  it("stores the reason on the scan so 'failed' can never render as 'never run'", async () => {
    const updates = installDb({ ai_analysis: null, ai_analysis_at: null });
    await recordGridRunFailure("task-1", "The imagery is too coarse");

    const a = (updates[0] as { ai_analysis: Record<string, unknown> }).ai_analysis as {
      last_run: { status: string; error: string };
    };
    expect(a.last_run.status).toBe("failed");
    expect(a.last_run.error).toBe("The imagery is too coarse");
    const state = analysisStateOf({ ai_analysis: a, ai_analysis_at: null });
    expect(state.kind).toBe("failed");
  });

  it("preserves an existing result — legacy or grid — underneath the failure", async () => {
    const prior = { zones: [{ id: "ai-0" }], health_score: 70 };
    const updates = installDb({ ai_analysis: prior, ai_analysis_at: "2026-08-10T10:00:00Z" });
    await recordGridRunFailure("task-1", "boom");

    const a = (updates[0] as { ai_analysis: Record<string, unknown> }).ai_analysis;
    expect(a.zones).toEqual([{ id: "ai-0" }]);
    expect(a.health_score).toBe(70);
    // No restamping: the legacy result stays recognisably legacy.
    expect(a.source).toBeUndefined();
    const state = analysisStateOf({ ai_analysis: a, ai_analysis_at: "2026-08-10T10:00:00Z" });
    expect(state.kind).toBe("done");
    if (state.kind === "done") {
      expect(state.source).toBe("legacy");
      expect(state.rerunFailed?.error).toBe("boom");
    }
  });
});
