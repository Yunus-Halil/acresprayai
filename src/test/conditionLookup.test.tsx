// The NOAA suggestion flow's one non-negotiable: a fetched value is not
// entered data until the operator explicitly accepts it.
//
// Everything else here is supporting detail — the station and its distance
// shown BEFORE the decision, the failure texts that leave manual entry as the
// path, the fetch reported to the parent for model_check either way.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConditionLookup from "@/components/app/workspace/ConditionLookup";
import { applicationInstant, observationFailureText } from "@/lib/weatherObservation";

const SUGGESTION_JSON = {
  ok: true,
  provider: "noaa-nws",
  station: "KMIC",
  station_name: "Minneapolis, Crystal Airport",
  distance_mi: 4.2,
  observed_at: "2026-08-25T21:55:00+00:00",
  wind_mph: 11,
  wind_dir: "SE",
  temp_f: 97,
};

function renderLookup(over: Partial<React.ComponentProps<typeof ConditionLookup>> = {}) {
  const onAccept = vi.fn();
  const onFetched = vi.fn();
  render(
    <ConditionLookup
      center={[45.01, -93.46]}
      dateYmd="2026-08-25"
      timeHm="16:55"
      onAccept={onAccept}
      onFetched={onFetched}
      {...over}
    />,
  );
  return { onAccept, onFetched };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the accept gate", () => {
  it("shows the suggestion with station and distance, and fills NOTHING until accepted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(SUGGESTION_JSON))));
    const { onAccept, onFetched } = renderLookup();

    fireEvent.click(screen.getByRole("button", { name: /look up conditions/i }));
    const card = await screen.findByTestId("condition-suggestion");

    // The operator sees what it is and where it came from BEFORE deciding.
    expect(card.textContent).toMatch(/11(\.0)? mph SE/);
    expect(card.textContent).toMatch(/97 °F/);
    expect(card.textContent).toMatch(/KMIC/);
    expect(card.textContent).toMatch(/4\.20? mi/);
    expect(card.textContent).toMatch(/station data, not conditions/i);

    // Fetched ≠ entered: the parent knows about the fetch (for model_check)
    // but acceptance has not happened.
    expect(onFetched).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /use these values/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0][0].wind_mph).toBe(11);
  });

  it("declining enters nothing and dismisses the suggestion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(SUGGESTION_JSON))));
    const { onAccept } = renderLookup();

    fireEvent.click(screen.getByRole("button", { name: /look up conditions/i }));
    await screen.findByTestId("condition-suggestion");
    fireEvent.click(screen.getByRole("button", { name: /enter what I observed/i }));

    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.queryByTestId("condition-suggestion")).toBeNull();
  });

  it("a failed lookup leaves the dialog exactly as manual entry, with a reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, reason: "out-of-retention" }))));
    const { onAccept, onFetched } = renderLookup();

    fireEvent.click(screen.getByRole("button", { name: /look up conditions/i }));
    await waitFor(() =>
      expect(screen.getByText(/older than the live NWS feed/i)).toBeInTheDocument());
    expect(screen.getByText(/NCEI archive, which is not wired in/i)).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
    expect(onFetched).not.toHaveBeenCalled();
  });

  it("requires the application start time before it will look anything up", () => {
    renderLookup({ timeHm: null });
    const btn = screen.getByRole("button", { name: /look up conditions/i });
    expect(btn).toBeDisabled();
    expect(btn.title).toMatch(/start time first/i);
  });

  it("renders nothing at all without a field centroid", () => {
    renderLookup({ center: null });
    expect(screen.queryByRole("button", { name: /look up conditions/i })).toBeNull();
  });
});

describe("time handling", () => {
  it("turns the operator's local date and time into a real instant, or refuses", () => {
    expect(applicationInstant("2026-08-25", "16:55")).toBeInstanceOf(Date);
    expect(applicationInstant("2026-08-25", "")).toBeNull();
    expect(applicationInstant("", "16:55")).toBeNull();
    expect(applicationInstant("25/08/2026", "16:55")).toBeNull();
  });
});

describe("failure texts steer to manual entry, never to a workaround", () => {
  it("every reason ends at the operator's own observation", () => {
    for (const reason of ["out-of-retention", "no-station", "no-observations", "unavailable"] as const) {
      expect(observationFailureText({ reason })).toMatch(/enter the conditions you observed/i);
    }
  });
});
