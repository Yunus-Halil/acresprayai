// Starring people on the pilot desk (src/lib/pilot/starred.ts, the People tab): the founder's own mark beside a
// person, kept in this browser, and a view of the list that shows only the starred. A star never opens the row it
// sits in, is remembered across visits, and says nothing to anyone else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/lib/pilot/adminClient", () => ({ pilotAdmin: vi.fn(async () => ({})) }));

import { PeopleSection, PersonDetail } from "@/components/pilot/admin/People";
import type { Snapshot } from "@/lib/pilot/adminData";

const at = new Date().toISOString();
const member = (user_id: string, display_name: string, role: "founder" | "participant" = "participant") => ({ user_id, role, status: "active" as const, email: `${user_id}@farm.test`, display_name, organisation: null, application_id: null, invited_at: at, created_at: at, notes: null });
const snap = (ids: [string, string][] = [["travis", "Travis Ford"], ["ryan", "Ryan Runkel"], ["alex", "Alex Risser"]]): Snapshot => ({
  generated_at: at, missing: {}, users: [], twins: [], consents: [], reviews: [], feedback: [], applications: [], access: [], events: [],
  members: [...ids.map(([id, name]) => member(id, name)), member("yunus", "Yunus", "founder")],
} as unknown as Snapshot);

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; }
const desk = (s: Snapshot = snap()) => render(
  <MemoryRouter initialEntries={["/admin/pilot?tab=people"]}>
    <Routes>
      <Route path="/admin/pilot" element={<><PeopleSection snap={s} /><Where /></>} />
      <Route path="/admin/pilot/people/:id" element={<><PersonDetail snap={s} userId="travis" onChanged={() => undefined} /><Where /></>} />
    </Routes>
  </MemoryRouter>,
);
const names = () => screen.getAllByRole("row").slice(1).map(r => within(r).getAllByRole("link")[0].textContent);
const star = (name: string) => screen.getByRole("button", { name: new RegExp(`^(Star|Remove the star from) ${name}$`) });
const view = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label} \\d+$`) });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe("starring people on the desk", () => {
  it("everyone is listed with an unpressed star, and the two views say how many each holds", () => {
    desk();
    expect(names()).toEqual(["Travis Ford", "Ryan Runkel", "Alex Risser", "Yunus"]);
    for (const n of ["Travis Ford", "Ryan Runkel", "Alex Risser", "Yunus"]) expect(star(n)).toHaveAttribute("aria-pressed", "false");
    expect(view("Everyone")).toHaveTextContent("Everyone 4");
    expect(view("Everyone")).toHaveAttribute("aria-pressed", "true");
    expect(view("Starred")).toHaveTextContent("Starred 0");
  });

  it("pressing a star marks that person and does not open their page; pressing again removes it", () => {
    desk();
    fireEvent.click(star("Travis Ford"));
    expect(star("Travis Ford")).toHaveAttribute("aria-pressed", "true");
    expect(star("Travis Ford")).toHaveAccessibleName("Remove the star from Travis Ford");
    expect(star("Ryan Runkel")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/pilot");
    expect(view("Starred")).toHaveTextContent("Starred 1");
    fireEvent.click(star("Travis Ford"));
    expect(star("Travis Ford")).toHaveAttribute("aria-pressed", "false");
    expect(view("Starred")).toHaveTextContent("Starred 0");
  });

  it("the Starred view shows only the starred, in the same order, and Everyone brings the rest back", () => {
    desk();
    fireEvent.click(star("Alex Risser")); fireEvent.click(star("Travis Ford"));
    fireEvent.click(view("Starred"));
    expect(names()).toEqual(["Travis Ford", "Alex Risser"]);
    expect(view("Starred")).toHaveAttribute("aria-pressed", "true");
    // Unstarring in that view takes the person out of it.
    fireEvent.click(star("Travis Ford"));
    expect(names()).toEqual(["Alex Risser"]);
    fireEvent.click(view("Everyone"));
    expect(names()).toEqual(["Travis Ford", "Ryan Runkel", "Alex Risser", "Yunus"]);
  });

  it("with nobody starred, the Starred view says how to star someone", () => {
    desk();
    fireEvent.click(view("Starred"));
    expect(screen.getByText("Nobody is starred yet. Show everyone, and press the star beside a name.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(view("Everyone"));
    expect(names()).toHaveLength(4);
  });

  it("stars and the chosen view are remembered in this browser across visits", () => {
    const first = desk();
    fireEvent.click(star("Ryan Runkel"));
    fireEvent.click(view("Starred"));
    first.unmount();
    desk();
    expect(view("Starred")).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Ryan Runkel"]);
    expect(star("Ryan Runkel")).toHaveAttribute("aria-pressed", "true");
  });

  it("a star left on someone who is no longer listed is not counted", () => {
    const first = desk();
    fireEvent.click(star("Ryan Runkel")); fireEvent.click(star("Travis Ford"));
    first.unmount();
    desk(snap([["travis", "Travis Ford"], ["alex", "Alex Risser"]]));
    expect(view("Starred")).toHaveTextContent("Starred 1");
    fireEvent.click(view("Starred"));
    expect(names()).toEqual(["Travis Ford"]);
  });

  it("what is kept is the account ids only, and nothing leaves the browser", () => {
    desk();
    fireEvent.click(star("Travis Ford"));
    const kept = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]));
    expect(Object.values(kept)).toContain('["travis"]');
    expect(JSON.stringify(kept)).not.toMatch(/Travis|farm\.test/);
  });

  it("damaged or foreign values in the browser's storage are ignored, not a crash", () => {
    for (const k of ["swathwise.pilot-desk.starred"]) localStorage.setItem(k, '{"not":"a list"');
    desk();
    expect(view("Starred")).toHaveTextContent("Starred 0");
    fireEvent.click(star("Alex Risser"));
    expect(view("Starred")).toHaveTextContent("Starred 1");
  });

  it("the star is on the person's own page too, and is the same star", () => {
    desk();
    fireEvent.click(star("Travis Ford"));
    fireEvent.click(screen.getByRole("link", { name: "Travis Ford" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/pilot/people/travis");
    expect(star("Travis Ford")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(star("Travis Ford"));
    expect(star("Travis Ford")).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("swathwise.pilot-desk.starred")).toBe("[]");
  });
});
