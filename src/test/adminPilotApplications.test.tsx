// The admin view of the pilot pipeline, and the guard in front of it.
//
// Two separate protections, tested separately because they fail differently:
// RequireAuth stops the page rendering for someone signed out, and the edge
// function stops rows reaching someone signed in who is not an admin. The
// second is the one that actually protects applicants' contact details - the
// route guard alone would let any customer read the list.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { useAuth, navigate, getSession } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  navigate: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ useAuth }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Outlet: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession } },
}));

import RequireAuth from "@/components/RequireAuth";
import PilotApplications from "@/pages/admin/PilotApplications";

const ROWS = [
  {
    id: "a2", created_at: "2026-08-17T09:00:00Z",
    full_name: "Ana Reyes", email: "ana@reyes.test", phone: null,
    farm_name: "Reyes Orchards", role: "Farm owner",
    location: "Yakima County, Washington", acreage_range: "20–100",
    crops: "apples, cherries", has_boundary_survey: "Yes",
    drone_status: "Have a spray drone", drone_model: "DJI Agras T40",
    availability: "This fall (Aug–Oct)", referral_source: null, notes: null,
  },
  {
    id: "a1", created_at: "2026-08-16T09:00:00Z",
    full_name: "Dale Hutchins", email: "dale@farms.test", phone: "555 0142",
    farm_name: "Hutchins Family Farms", role: "Farm manager",
    location: "Story County, Iowa", acreage_range: "100–500",
    crops: "corn", has_boundary_survey: null,
    drone_status: "No drone yet", drone_model: null,
    availability: "Spring 2027", referral_source: null, notes: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
});

describe("the route guard", () => {
  it("sends a signed-out visitor to /auth and renders nothing of the page", () => {
    useAuth.mockReturnValue({ user: null, loading: false });

    render(<RequireAuth><PilotApplications /></RequireAuth>);

    expect(navigate).toHaveBeenCalledWith("/auth", { replace: true });
    expect(screen.queryByText("Applications")).not.toBeInTheDocument();
  });

  it("waits rather than bouncing someone mid-session-restore", () => {
    // The session resolves asynchronously on a cold load. Redirecting during
    // that window would throw a signed-in admin back to the login screen.
    useAuth.mockReturnValue({ user: null, loading: true });

    render(<RequireAuth><PilotApplications /></RequireAuth>);

    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders the page for a signed-in user", async () => {
    useAuth.mockReturnValue({ user: { id: "user-1" }, loading: false });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ applications: [] }), { status: 200 })));

    render(<RequireAuth><PilotApplications /></RequireAuth>);

    expect(navigate).not.toHaveBeenCalled();
    expect(await screen.findByText("Applications")).toBeInTheDocument();
  });
});

describe("the list", () => {
  beforeEach(() => useAuth.mockReturnValue({ user: { id: "user-1" }, loading: false }));

  it("shows every submission, newest first, with the columns needed to triage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ applications: ROWS }), { status: 200 })));

    render(<PilotApplications />);

    expect(await screen.findByText("Ana Reyes")).toBeInTheDocument();
    expect(screen.getByText("Dale Hutchins")).toBeInTheDocument();
    expect(screen.getByText("Reyes Orchards")).toBeInTheDocument();
    expect(screen.getByText("Story County, Iowa")).toBeInTheDocument();
    expect(screen.getByText("100–500")).toBeInTheDocument();
    expect(screen.getByText("DJI Agras T40")).toBeInTheDocument();
    expect(screen.getByText("Spring 2027")).toBeInTheDocument();

    // The order the function returned is the order shown; the newest is first.
    const names = screen.getAllByText(/Ana Reyes|Dale Hutchins/).map(n => n.textContent);
    expect(names).toEqual(["Ana Reyes", "Dale Hutchins"]);
  });

  it("carries the session token so the function can authorise the caller", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ applications: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotApplications />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt");
  });

  it("says so plainly when the caller is signed in but not an admin", async () => {
    // The server refuses; the page must not pretend the pipeline is empty.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "Not authorized" }), { status: 403 })));

    render(<PilotApplications />);

    expect(await screen.findByText(/limited to the pilot programme admins/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("distinguishes an empty pipeline from a failed load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "Could not load applications" }), { status: 500 })));

    render(<PilotApplications />);

    expect(await screen.findByText("Could not load applications")).toBeInTheDocument();
    expect(screen.queryByText(/no applications yet/i)).not.toBeInTheDocument();
  });
});
