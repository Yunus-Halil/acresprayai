// The app shell by role: a participant's menu holds the pilot and nothing else; the founder's adds the tools; the
// founder's preview shows the participant menu with a banner saying so.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const pilot = { role: "participant" as "founder" | "participant", serverRole: "participant" as "founder" | "participant", preview: false };
const setPreview = vi.fn();

// The agreement is never read from the live project in a test.
vi.mock("@/lib/pilot/consent", async orig => ({ ...(await orig<typeof import("@/lib/pilot/consent")>()), loadConsent: async () => null }));
vi.mock("@/components/pilot/PilotRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", email: "ryan@farm.test" }, signOut: vi.fn() }) }));
vi.mock("@/lib/unitPreference", () => ({ loadUnitPreference: async () => "imperial", saveUnitPreference: async () => undefined }));
vi.mock("@/lib/pilot/access", () => ({
  usePilotRole: () => pilot.role,
  usePilot: () => ({ access: { status: "member", role: pilot.role, serverRole: pilot.serverRole, displayName: null }, preview: pilot.preview, setPreview, reload: () => undefined }),
}));

import AppLayout from "@/components/app/AppLayout";

const renderShell = () => render(
  <MemoryRouter initialEntries={["/app/help"]}>
    <Routes><Route path="/app" element={<AppLayout />}><Route path="help" element={<div>help page</div>} /></Route></Routes>
  </MemoryRouter>,
);

const FOUNDER_TOOLS = ["Operations dashboard", "Fields (orthomosaic)", "Drone Fleet", "Spray Conditions", "Schedule", "Weed Library", "Photo Scout", "Pilot admin"];

beforeEach(() => { pilot.role = "participant"; pilot.serverRole = "participant"; pilot.preview = false; });

describe("the app shell", () => {
  it("a participant's menu is the pilot only", () => {
    renderShell();
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    expect(within(nav).getByRole("link", { name: /Field Twins/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Help/ })).toBeInTheDocument();
    for (const t of FOUNDER_TOOLS) expect(within(nav).queryByRole("link", { name: new RegExp(t.replace(/[()]/g, "\\$&")) })).toBeNull();
    expect(screen.queryByText(/Preview as a participant/)).toBeNull();
  });

  it("the founder's menu adds every tool, and the preview switch", () => {
    pilot.role = "founder"; pilot.serverRole = "founder";
    renderShell();
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    for (const t of FOUNDER_TOOLS) expect(within(nav).getByRole("link", { name: new RegExp(t.replace(/[()]/g, "\\$&")) })).toBeInTheDocument();
    expect(screen.getByText(/Preview as a participant/)).toBeInTheDocument();
  });

  it("previewing, the founder sees the participant menu and a banner to stop", () => {
    pilot.role = "participant"; pilot.serverRole = "founder"; pilot.preview = true;
    renderShell();
    expect(screen.getByRole("status")).toHaveTextContent(/previewing what a pilot participant sees/);
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    expect(within(nav).queryByRole("link", { name: /Drone Fleet/ })).toBeNull();
    screen.getByRole("button", { name: "Stop previewing" }).click();
    expect(setPreview).toHaveBeenCalledWith(false);
  });
});
