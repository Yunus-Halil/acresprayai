// The app's reading of pilot membership: which screen a signed-in person gets, what the founder's preview does,
// and the sign-in helpers. The server enforces all of it again (src/test/sql, src/test/edge); this is what the
// person sees.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

let memberRow: Record<string, unknown> | null = null;
let memberError: { code?: string; message: string } | null = null;
const signOut = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(table === "pilot_members" ? { data: memberRow, error: memberError } : { data: null, error: null }),
        }),
      }),
    }),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", email: "ryan@farm.test" }, session: null, loading: false, signOut }) }));

import { loadMembership, PilotAccessProvider, usePilot, usePilotRole } from "@/lib/pilot/access";
import { FounderOnly, PilotGate } from "@/components/pilot/PilotGate";
import { passwordProblem, returnedAuthError } from "@/lib/pilot/authText";

beforeEach(() => { memberRow = null; memberError = null; localStorage.clear(); });

describe("loadMembership", () => {
  it("reads an active founder and an active participant", async () => {
    memberRow = { role: "founder", status: "active", display_name: "Yunus" };
    expect(await loadMembership("u1")).toEqual({ status: "member", serverRole: "founder", role: "founder", displayName: "Yunus" });
    memberRow = { role: "participant", status: "active", display_name: null };
    expect(await loadMembership("u1")).toMatchObject({ status: "member", role: "participant" });
  });
  it.each([null, { role: "participant", status: "paused" }, { role: "participant", status: "ended" }, { role: "admin", status: "active" }])(
    "anything else is outside the pilot: %o", async (row) => {
      memberRow = row;
      expect(await loadMembership("u1")).toEqual({ status: "outside" });
    },
  );
  it("a database not yet updated for the pilot is said so, not shown as 'outside'", async () => {
    memberError = { code: "PGRST205", message: "Could not find the table 'public.pilot_members' in the schema cache" };
    expect(await loadMembership("u1")).toMatchObject({ status: "error", message: expect.stringMatching(/being updated/) });
  });
  it("a network failure is an error with a retry, never a silent 'outside'", async () => {
    memberError = { message: "Failed to fetch" };
    expect(await loadMembership("u1")).toMatchObject({ status: "error" });
  });
});

function Probe() {
  const role = usePilotRole();
  const { preview, setPreview } = usePilot();
  return <div><span data-testid="role">{role ?? "none"}</span><span data-testid="preview">{String(preview)}</span><button onClick={() => setPreview(!preview)}>toggle</button></div>;
}

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <PilotAccessProvider userId="u1">
      <PilotGate>
        <Routes>
          <Route path="/app" element={<Probe />} />
          <Route path="/app/fields" element={<FounderOnly><div>Fields (founder tool)</div></FounderOnly>} />
        </Routes>
      </PilotGate>
    </PilotAccessProvider>
  </MemoryRouter>,
);

describe("the screens", () => {
  it("an account outside the pilot gets the explanation and sign-out, not the app", async () => {
    memberRow = null;
    renderAt("/app");
    expect(await screen.findByText("This account is not in the pilot")).toBeInTheDocument();
    expect(screen.getByText("ryan@farm.test")).toBeInTheDocument();
    expect(screen.queryByTestId("role")).toBeNull();
  });

  it("a participant who opens a founder tool by its address is sent home", async () => {
    memberRow = { role: "participant", status: "active", display_name: null };
    renderAt("/app/fields");
    expect(await screen.findByTestId("role")).toHaveTextContent("participant");
    expect(screen.queryByText("Fields (founder tool)")).toBeNull();
  });

  it("the founder reaches founder tools", async () => {
    memberRow = { role: "founder", status: "active", display_name: null };
    renderAt("/app/fields");
    expect(await screen.findByText("Fields (founder tool)")).toBeInTheDocument();
  });

  it("the founder's preview shows the participant experience and survives a reload of the page", async () => {
    memberRow = { role: "founder", status: "active", display_name: null };
    const first = renderAt("/app");
    expect(await screen.findByTestId("role")).toHaveTextContent("founder");
    screen.getByText("toggle").click();
    expect(await screen.findByText("participant")).toBeInTheDocument();
    expect(screen.getByTestId("preview")).toHaveTextContent("true");
    first.unmount();
    renderAt("/app");
    expect(await screen.findByText("participant")).toBeInTheDocument();
  });

  it("a participant cannot preview their way into founder tools", async () => {
    memberRow = { role: "participant", status: "active", display_name: null };
    localStorage.setItem("swathwise.pilot-preview", "1");
    renderAt("/app");
    expect(await screen.findByTestId("role")).toHaveTextContent("participant");
    expect(screen.getByTestId("preview")).toHaveTextContent("false");
  });
});

describe("sign-in helpers", () => {
  it("explains an uninvited Google account and an expired link in plain words", () => {
    expect(returnedAuthError("", "#error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance")).toMatch(/not invited/);
    expect(returnedAuthError("?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", "")).toMatch(/expired/);
    expect(returnedAuthError("", "#access_token=abc&type=invite")).toBeNull();
  });
  it("asks for a usable password", () => {
    expect(passwordProblem("short", "short")).toMatch(/at least 8/);
    expect(passwordProblem("long enough 1", "long enough 2")).toMatch(/not the same/);
    expect(passwordProblem("long enough", "long enough")).toBeNull();
  });
});
