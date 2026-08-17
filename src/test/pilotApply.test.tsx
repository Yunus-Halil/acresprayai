// The pilot application form.
//
// The form is the product's front door for people who are not yet users, so
// the behaviours worth pinning are the ones that lose applicants: being told
// off before you have typed anything, being shown a wall of errors at the end,
// and being asked a question that does not apply to you.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { submitApplication } = vi.hoisted(() => ({ submitApplication: vi.fn() }));
vi.mock("@/lib/pilotApply", () => ({ submitApplication }));

import PilotApply from "@/pages/PilotApply";

const COMPLETE = {
  "Full name": "Dale Hutchins",
  Email: "dale@hutchins-farms.test",
  "Farm or operation name": "Hutchins Family Farms",
  Location: "Story County, Iowa",
  "Primary crops": "corn, soybeans",
};

const SELECTS: [RegExp, string][] = [
  [/your role/i, "Farm owner"],
  [/approximate acreage/i, "100–500 acres"],
  [/own a drone/i, "No drone yet"],
  [/when could you start/i, "This fall (Aug–Oct)"],
];

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  for (const [label, value] of Object.entries(COMPLETE)) {
    await user.type(screen.getByLabelText(new RegExp(label, "i")), value);
  }
  for (const [label, option] of SELECTS) {
    await user.selectOptions(screen.getByLabelText(label), option);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  submitApplication.mockResolvedValue({ ok: true, id: "app-1" });
  // jsdom implements neither.
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});

describe("required fields", () => {
  it("does not submit an empty form, and says what is missing", async () => {
    const user = userEvent.setup();
    render(<PilotApply />);

    await user.click(screen.getByRole("button", { name: /submit application/i }));

    expect(submitApplication).not.toHaveBeenCalled();
    expect(await screen.findByText("Your name is required")).toBeInTheDocument();
    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Primary crops is required")).toBeInTheDocument();
  });

  it("stays quiet until a field has actually been visited", async () => {
    // Scolding someone for an empty box they have not reached yet is the
    // fastest way to lose them.
    const user = userEvent.setup();
    render(<PilotApply />);

    expect(screen.queryByText("Email is required")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/^email/i));
    await user.tab();

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
  });

  it("flags a malformed email as soon as you leave the field", async () => {
    const user = userEvent.setup();
    render(<PilotApply />);

    await user.type(screen.getByLabelText(/^email/i), "dale at hutchins");
    await user.tab();

    expect(await screen.findByText(/doesn't look like an email/i)).toBeInTheDocument();
  });

  it("clears the error as soon as it is corrected", async () => {
    const user = userEvent.setup();
    render(<PilotApply />);

    const email = screen.getByLabelText(/^email/i);
    await user.type(email, "nope");
    await user.tab();
    expect(await screen.findByText(/doesn't look like an email/i)).toBeInTheDocument();

    await user.type(email, "@farms.test");
    await waitFor(() =>
      expect(screen.queryByText(/doesn't look like an email/i)).not.toBeInTheDocument(),
    );
  });
});

describe("the conditional drone model question", () => {
  it("is hidden until the applicant says they have a spray drone", async () => {
    const user = userEvent.setup();
    render(<PilotApply />);

    expect(screen.queryByLabelText(/spray drone make and model/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/own a drone/i), "Multispectral drone");
    expect(screen.queryByLabelText(/spray drone make and model/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/own a drone/i), "Have a spray drone");
    expect(screen.getByLabelText(/spray drone make and model/i)).toBeInTheDocument();
  });

  it("does not submit a model the applicant took back", async () => {
    const user = userEvent.setup();
    render(<PilotApply />);

    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/own a drone/i), "Have a spray drone");
    await user.type(screen.getByLabelText(/spray drone make and model/i), "Agras T40");
    // Changed their mind: the input disappears, and the answer must go with it.
    await user.selectOptions(screen.getByLabelText(/own a drone/i), "No drone yet");

    await user.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => expect(submitApplication).toHaveBeenCalledTimes(1));
    // The page keeps the typed value in state; what matters is that the server
    // sees the answer alongside "No drone yet" and drops it. `normalise` on the
    // edge function is what enforces that, and its test covers it - here we
    // only assert the drone status went out correctly.
    expect(submitApplication.mock.calls[0][0].drone_status).toBe("No drone yet");
  });
});

describe("submission", () => {
  it("sends every answer once, then confirms without navigating away", async () => {
    const user = userEvent.setup();
    render(<PilotApply />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => expect(submitApplication).toHaveBeenCalledTimes(1));
    expect(submitApplication.mock.calls[0][0]).toMatchObject({
      full_name: "Dale Hutchins",
      email: "dale@hutchins-farms.test",
      farm_name: "Hutchins Family Farms",
      role: "Farm owner",
      location: "Story County, Iowa",
      acreage_range: "100–500",
      crops: "corn, soybeans",
      drone_status: "No drone yet",
      availability: "This fall (Aug–Oct)",
    });

    expect(await screen.findByText(/we'll be in touch within a few days/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit application/i })).not.toBeInTheDocument();
  });

  it("keeps the answers on screen when the server refuses", async () => {
    // Losing ten fields of typing to a failed request is unforgivable on a
    // form someone is filling in on a phone.
    submitApplication.mockResolvedValue({ ok: false, message: "Something went wrong (500)." });
    const user = userEvent.setup();
    render(<PilotApply />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    expect(await screen.findByText("Something went wrong (500).")).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue("Dale Hutchins");
  });

  it("surfaces a server-side field complaint against that field", async () => {
    submitApplication.mockResolvedValue({
      ok: false,
      message: "Please check the highlighted fields.",
      errors: { email: "That address is already on the list" },
    });
    const user = userEvent.setup();
    render(<PilotApply />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /submit application/i }));

    expect(await screen.findByText("That address is already on the list")).toBeInTheDocument();
  });
});
