// A sorted corn twin's doubles (class 7, 2026-11-20): not in the plant count, not drawn or picked in Realistic, Simple
// or Geometry, and shown in blue only with the founder's "All layers" (the map's showDoubles, the panel's technical).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CornFieldPanel, CornLegend } from "@/components/app/fieldTwin/CornPanels";
import { TwinCanvasLayer } from "@/components/app/fieldTwin/TwinCanvasLayer";
import { DEFAULT_LAYERS } from "@/lib/fieldTwin/style";
import { syntheticCornTwin } from "@/lib/fieldTwin/syntheticCorn";
import type { TwinBundle } from "@/lib/fieldTwin/types";

/** A synthetic corn twin, sorted, with its first `doubles` on-row plants made doubles. */
function sortedTwin(doubles: number): TwinBundle {
  const t = JSON.parse(JSON.stringify(syntheticCornTwin({ plants: 500 }))) as TwinBundle;
  const P = t.corn!.plants!;
  let made = 0;
  for (let i = 0; i < P.certainty.length && made < doubles; i++) if (P.certainty[i] === 0) { P.certainty[i] = 7; made++; }
  P.summary.doubles = made;
  return t;
}
const counts = (t: TwinBundle) => {
  const c = t.corn!.plants!.certainty;
  return { onRows: c.filter(v => v === 0 || v === 1 || v === 4 || v === 5 || v === 6).length, notCorn: c.filter(v => v === 2 || v === 3).length };
};

describe("the doubles on a sorted corn twin", () => {
  it("are not in the plant count, and are listed only with All layers", () => {
    const t = sortedTwin(20), { onRows, notCorn } = counts(t);
    const panel = (technical: boolean) => render(<CornFieldPanel twin={t} corn={t.corn!} layers={DEFAULT_LAYERS} setLayers={() => undefined} onSelect={() => undefined} units="imperial" view="realistic" technical={technical} />);
    const a = panel(false), box = () => screen.getByRole("group", { name: "Plant count" });
    expect(box()).toHaveTextContent(new RegExp(`Plants counted${onRows.toLocaleString()}`));
    expect(box()).toHaveTextContent(new RegExp(`Green, not corn \\(not counted\\)${notCorn.toLocaleString()}`));
    expect(box()).not.toHaveTextContent(/Doubles/);
    a.unmount();
    panel(true);
    expect(box()).toHaveTextContent(new RegExp(`Plants counted${onRows.toLocaleString()}`));
    expect(box()).toHaveTextContent(/Doubles \(not counted\)20/);
  });
  it("are in the key only with All layers, in every view", () => {
    const t = sortedTwin(20);
    for (const view of ["realistic", "simple", "geometry"] as const) {
      const a = render(<CornLegend corn={t.corn!} showPlants uncertain={false} view={view} />);
      expect(screen.getByLabelText("Corn legend")).not.toHaveTextContent(/Double/);
      a.unmount();
      const b = render(<CornLegend corn={t.corn!} showPlants uncertain={false} view={view} doubles />);
      expect(screen.getByLabelText("Corn legend")).toHaveTextContent(/Double: very close to a plant on its row \(not counted/);
      b.unmount();
    }
  });
  it("are left out of the map's views until All layers is on", () => {
    const t = sortedTwin(3), P = t.corn!.plants!;
    const layer = new TwinCanvasLayer(DEFAULT_LAYERS);
    layer.setPlants(P.points, true, P.certainty, true);
    const hidden = (k: number) => (layer as unknown as { doubleHidden(k: number): boolean }).doubleHidden(k);
    const double = P.certainty.indexOf(7), row = P.certainty.indexOf(0), off = P.certainty.findIndex(c => c === 2 || c === 3);
    expect([hidden(double), hidden(row), hidden(off)]).toEqual([true, false, false]);
    layer.setShowDoubles(true);
    expect(hidden(double)).toBe(false);
    // A twin from before the sort: nothing is hidden (class 7 never occurs there, and the views drew everything).
    layer.setShowDoubles(false); layer.setPlants(P.points, true, P.certainty, false);
    expect(hidden(double)).toBe(false);
  });
});
