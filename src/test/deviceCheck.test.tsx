// The founder's device testing: the marker of how far a build got on this device (a build the browser stopped is
// told apart from one running in this tab), and the device check page saying so.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { beginTrace, endTrace, stoppedBuildText, traceProgress, unfinishedTrace } from "@/lib/fieldTwin/buildTrace";
import { probeCanvas } from "@/lib/fieldTwin/deviceCheck";
import DeviceCheck from "@/pages/app/DeviceCheck";

beforeEach(() => { localStorage.clear(); endTrace(); });

describe("the build marker", () => {
  it("is left while a build runs, says how far it got, and is gone when it ends", () => {
    beginTrace(123, "corn", 1_000);
    traceProgress("photographs", 2_000);
    traceProgress("cameras", 5_000);
    traceProgress("cameras", 6_000); // the same stage, within the heartbeat: not written again
    traceProgress("corn", 70_000);
    const t = unfinishedTrace(false)!;
    expect(t).toMatchObject({ photographs: 123, crop: "corn", stage: "corn", lastAt: 70_000, stages: { photographs: 1_000, cameras: 4_000, corn: 69_000 } });
    expect(stoppedBuildText(t)).toMatch(/A build of 123 photographs \(corn\).*did not finish.*69 s in, during "corn"/);
    // The build running in this tab is not a stopped one.
    expect(unfinishedTrace(true)).toBeNull();
    endTrace();
    expect(unfinishedTrace(false)).toBeNull();
  });

  it("holds nothing from the photographs", () => {
    beginTrace(5, "orchard", 0);
    traceProgress("cameras", 10);
    const raw = Object.keys(localStorage).map(k => localStorage.getItem(k)).join("");
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["crop", "lastAt", "photographs", "stage", "stageAt", "stages", "startedAt"]);
  });
});

describe("the device check", () => {
  it("shows a build the browser stopped, and says what a browser without the build's features lacks", async () => {
    beginTrace(123, "corn", Date.now() - 200_000);
    traceProgress("corn", Date.now() - 100_000);
    render(<MemoryRouter><DeviceCheck /></MemoryRouter>);
    expect(screen.getByText(/did not finish/)).toBeInTheDocument();
    expect(await screen.findByText("Seen as an iPad")).toBeInTheDocument();
    // jsdom has no OffscreenCanvas: every size is refused, with the reason.
    expect(probeCanvas(4096, 4096)).toMatchObject({ ok: false, why: "no OffscreenCanvas" });
  });
});
