// The banner on a corn twin built from a late flight (LateFlightBanner.tsx): shown for a late flight only, closable,
// remembered per twin; and the twin's record of the flight's stage accepted when well formed, refused when not.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import LateFlightBanner from "@/components/app/fieldTwin/LateFlightBanner";
import { syntheticCornTwin } from "@/lib/fieldTwin/syntheticCorn";
import { parseTwin } from "@/lib/fieldTwin/types";

const LATE = { version: 1 as const, looked: 40, late: 31, photoCut: 0.5, verdict: "late" as const };

beforeEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });

describe("the late-flight banner", () => {
  it("says how many photographs read late and what to do, and closes for good on this twin", () => {
    const r = render(<LateFlightBanner twinId="t1" stage={LATE} />);
    const b = screen.getByRole("status", { name: "Late flight" });
    expect(b).toHaveTextContent("This looks like a late flight");
    expect(b).toHaveTextContent(/In 31 of the 40 photographs the corn canopy has closed/);
    expect(b).toHaveTextContent(/use photographs from earlier in the season/);
    expect(b).toHaveTextContent(/Support for later flights is coming in an update/);
    fireEvent.click(screen.getByRole("button", { name: "Close the late-flight notice" }));
    expect(screen.queryByRole("status", { name: "Late flight" })).toBeNull();
    r.unmount();
    render(<LateFlightBanner twinId="t1" stage={LATE} />);
    expect(screen.queryByRole("status", { name: "Late flight" })).toBeNull();
  });
  it("says nothing for a flight that is not late, or a twin built before the stage was read", () => {
    render(<><LateFlightBanner twinId="t2" stage={{ ...LATE, late: 2, verdict: "ok" }} /><LateFlightBanner twinId="t3" stage={undefined} /></>);
    expect(screen.queryByRole("status", { name: "Late flight" })).toBeNull();
  });
});

describe("the corn panel on a late twin", () => {
  it("says the count was not made because the canopy has closed", async () => {
    const { CornFieldPanel } = await import("@/components/app/fieldTwin/CornPanels");
    const { DEFAULT_LAYERS } = await import("@/lib/fieldTwin/style");
    const t = JSON.parse(JSON.stringify(syntheticCornTwin({ plants: 500 })));
    delete t.corn.plants; t.corn.stage = LATE;
    render(<CornFieldPanel twin={t} corn={t.corn} layers={DEFAULT_LAYERS} setLayers={() => undefined} onSelect={() => undefined} units="imperial" view="realistic" />);
    expect(screen.getByRole("group", { name: "Stand" })).toHaveTextContent(/not counted on this flight.*The corn canopy has closed in 31 of the 40 photographs/);
    // One line on the flight, because it limits the result.
    expect(screen.getByRole("note", { name: "Flight" })).toHaveTextContent(/late: the canopy has closed in 31 of the 40 photographs/);
  });
});

describe("the flight's stage in a twin", () => {
  const base = () => JSON.parse(JSON.stringify(syntheticCornTwin({ plants: 500 })));
  it("is accepted when well formed", () => {
    const t = base(); t.corn.stage = LATE;
    expect(parseTwin(t).ok).toBe(true);
  });
  it("is refused when broken", () => {
    for (const stage of [{ ...LATE, version: 2 }, { ...LATE, verdict: "maybe" }, { ...LATE, late: 41 }, { ...LATE, looked: "40" }]) {
      const t = base(); t.corn.stage = stage;
      expect(parseTwin(t)).toMatchObject({ ok: false });
    }
  });
});
