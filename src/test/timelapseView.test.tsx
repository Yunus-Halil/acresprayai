// The timelapse control itself: when it appears, what it draws, and that
// playback runs once.
//
// Leaflet is mocked so the tile layers can be inspected directly - the thing
// worth asserting is which layer is at which opacity, and a real map in jsdom
// would only get in the way of seeing it.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { tileLayers, mapInstances, supabaseFrom } = vi.hoisted(() => ({
  tileLayers: [] as { url: string; opacity: number }[],
  mapInstances: [] as { removed: boolean }[],
  supabaseFrom: vi.fn(),
}));

vi.mock("leaflet", () => {
  const tileLayer = (url: string, opts: { opacity?: number }) => {
    const rec = { url, opacity: opts?.opacity ?? 1 };
    tileLayers.push(rec);
    const layer = {
      addTo: () => layer,
      setOpacity: (o: number) => { rec.opacity = o; return layer; },
    };
    return layer;
  };
  const map = () => {
    const inst = { removed: false };
    mapInstances.push(inst);
    return {
      fitBounds: () => {}, setView: () => {},
      remove: () => { inst.removed = true; },
    };
  };
  return { default: { map, tileLayer } };
});

// Timelapse must never talk to the database. If it ever grows an import, this
// mock is what the call would land in.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: supabaseFrom } }));

import Timelapse from "@/components/app/Timelapse";

const scan = (n: number, iso: string) => ({ id: `t${n}`, odm_uuid: `uuid-${n}`, created_at: iso });
const THREE = [
  scan(1, "2026-05-01T10:00:00Z"),
  scan(2, "2026-06-01T10:00:00Z"),
  scan(3, "2026-07-01T10:00:00Z"),
];

const opacities = () => tileLayers.map(l => l.opacity);

beforeEach(() => {
  tileLayers.length = 0;
  mapInstances.length = 0;
  supabaseFrom.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("when it appears at all", () => {
  it("renders nothing for a field with no completed scans", () => {
    const { container } = render(<Timelapse scans={[]} boundary={null} token="jwt" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a single scan - there is no transition to play", () => {
    const { container } = render(<Timelapse scans={[THREE[0]]} boundary={null} token="jwt" />);
    expect(container).toBeEmptyDOMElement();
    expect(tileLayers).toHaveLength(0);
  });

  it("appears once a second scan exists", () => {
    render(<Timelapse scans={THREE.slice(0, 2)} boundary={null} token="jwt" />);
    expect(screen.getByRole("slider", { name: /scan timeline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play timelapse/i })).toBeInTheDocument();
  });
});

describe("what it draws", () => {
  it("mounts one tile layer per scan, carrying the session token", () => {
    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);
    expect(tileLayers).toHaveLength(3);
    expect(tileLayers[0].url).toContain("/tile/uuid-1/");
    expect(tileLayers[2].url).toContain("/tile/uuid-3/");
    for (const l of tileLayers) expect(l.url).toContain("token=jwt");
  });

  it("labels every scan on the timeline", () => {
    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);
    expect(screen.getByText("May 1")).toBeInTheDocument();
    expect(screen.getByText("Jun 1")).toBeInTheDocument();
    expect(screen.getByText("Jul 1")).toBeInTheDocument();
    expect(screen.getByText(/scan 1 of 3/i)).toBeInTheDocument();
  });

  it("starts on the oldest scan alone", () => {
    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);
    expect(opacities()).toEqual([1, 0, 0]);
  });
});

describe("scrubbing", () => {
  const drag = (value: string) => {
    const slider = screen.getByRole("slider", { name: /scan timeline/i }) as HTMLInputElement;
    act(() => {
      // Range inputs need the native setter to fire a real change in jsdom.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(slider, value);
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("splits opacity between the two nearest scans as it moves", () => {
    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);

    drag("0");
    expect(opacities()).toEqual([1, 0, 0]);

    drag("0.5");
    expect(opacities()).toEqual([0.5, 0.5, 0]);

    drag("1");
    expect(opacities()).toEqual([0, 1, 0]);

    drag("2");
    expect(opacities()).toEqual([0, 0, 1]);
  });

  it("never leaves the map blank part-way through a transition", () => {
    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);
    for (const p of ["0.1", "0.37", "0.9", "1.42", "1.99"]) {
      drag(p);
      const total = opacities().reduce((a, b) => a + b, 0);
      expect(total, `total opacity at ${p}`).toBeCloseTo(1, 10);
    }
  });
});

describe("playback", () => {
  it("advances on its own and stops at the last scan without looping", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);
    await user.click(screen.getByRole("button", { name: /play timelapse/i }));

    // Part-way: somewhere between the first and second scan.
    act(() => { vi.advanceTimersByTime(1250); });
    const mid = opacities();
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[0]).toBeLessThan(1);
    expect(mid[1]).toBeGreaterThan(0);

    // Well past the end of a 3-scan timeline (2 transitions = 5000ms at 1x).
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(opacities()).toEqual([0, 0, 1]);

    // Still parked on the last scan, and offering a replay rather than
    // silently starting over.
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(opacities()).toEqual([0, 0, 1]);
    expect(screen.getByRole("button", { name: /replay timelapse/i })).toBeInTheDocument();
  });

  it("offers a speed control that toggles between 1x and 2x", async () => {
    const user = userEvent.setup();
    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);

    const speed = screen.getByRole("button", { name: /playback speed 1x/i });
    await user.click(speed);
    expect(screen.getByRole("button", { name: /playback speed 2x/i })).toBeInTheDocument();
  });
});

describe("it is read-only", () => {
  it("never touches the database", () => {
    render(<Timelapse scans={THREE} boundary={null} token="jwt" />);
    expect(supabaseFrom).not.toHaveBeenCalled();
  });
});
