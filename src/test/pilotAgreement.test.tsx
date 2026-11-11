// The pilot agreement (src/components/pilot/ConsentScreen.tsx, src/lib/pilot/consent.ts): one screen, one button.
// Agreeing to the terms in force is required and is what lets the founder open the participant's Field Twins;
// research use of imagery is a separate choice on the same screen, never ticked for the participant, never needed to
// continue, and never carried over from earlier terms. Nothing of the app is shown before the agreement, an
// agreement that cannot be read is neither "agreed" nor "not agreed", and a participant who agreed to earlier terms
// keeps exactly what they chose there until they agree again themselves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Row = { terms_version: string; troubleshooting_access: boolean; research_use: boolean; created_at: string };
// The account's agreement rows, newest last, as the database holds them.
let rows: Row[] = [];
let readFails: string | null = null;
let insertFails: string | null = null;
const inserted: Record<string, unknown>[] = [];
let reads = 0;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "pilot_consents") {
        // The access history, when its section is opened.
        const q = { select: () => q, order: () => q, limit: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) };
        return q;
      }
      const q = {
        select: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => { reads++; return readFails ? { data: null, error: { message: readFails } } : { data: rows.at(-1) ?? null, error: null }; },
        insert: async (row: Record<string, unknown>) => {
          if (insertFails) return { error: { message: insertFails } };
          inserted.push(row);
          rows.push({ ...(row as unknown as Row), created_at: new Date().toISOString() });
          return { error: null };
        },
      };
      return q;
    },
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "p1", email: "travis@extension.test" } }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

import ConsentPage, { ConsentGate } from "@/components/pilot/ConsentScreen";
import PilotTerms from "@/pages/PilotTerms";
import { TERMS_APPROVED, TERMS_VERSION, agreedToCurrent, researchChoice } from "@/lib/pilot/consent";

const V1 = (over: Partial<Row> = {}): Row => ({ terms_version: "pilot-2026-11-v1", troubleshooting_access: false, research_use: false, created_at: "2026-11-09T10:00:00Z", ...over });
const V2 = (over: Partial<Row> = {}): Row => ({ terms_version: TERMS_VERSION, troubleshooting_access: true, research_use: false, created_at: "2026-11-11T10:00:00Z", ...over });
const APP = "THE APP: Field Twins";
const gate = (required = true) => render(<MemoryRouter><ConsentGate required={required}><div>{APP}</div></ConsentGate></MemoryRouter>);
const agreeButton = () => screen.findByRole("button", { name: "Agree & Continue" });
const research = () => screen.getByRole("checkbox") as HTMLInputElement;

beforeEach(() => { rows = []; readFails = null; insertFails = null; inserted.length = 0; reads = 0; toastError.mockClear(); });
afterEach(() => { cleanup(); });

describe("the terms in force", () => {
  it("are version 2, approved by the founder, and the page carries no draft notice", () => {
    expect(TERMS_VERSION).toBe("pilot-2026-11-v2");
    // The founder's decision (2026-11-11), made by changing this constant; a new version starts unapproved.
    expect(TERMS_APPROVED).toBe(true);
    render(<MemoryRouter><PilotTerms /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Founding pilot: terms and privacy" })).toBeInTheDocument();
    expect(screen.getByText(`Version ${TERMS_VERSION}`)).toBeInTheDocument();
    expect(screen.queryByText(/Draft wording/)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the terms page says what the system does, no more", () => {
  const page = readFileSync(resolve(process.cwd(), "src/pages/PilotTerms.tsx"), "utf8");
  it("photographs: the full originals are not uploaded, and it says the crops are saved", () => {
    expect(page).toContain("Your full original drone photographs are not uploaded.");
    expect(page).toContain("Small evidence crops cut from them are saved, as described below.");
    expect(page).not.toContain("They are not uploaded.");
  });
  it("the analysis record: kept to reproduce and evaluate the original analysis, without promising an exact result; and what happens to one whose twin is deleted", () => {
    expect(page).toContain("to preserve the intermediate observations needed to reproduce and evaluate the original analysis of your field");
    expect(page).not.toMatch(/reproduced later exactly/);
    expect(page).toContain("No record is kept for a Field Twin you have deleted");
    expect(page).toContain("at the latest the next time you open your list of Field Twins");
    expect(page).not.toMatch(/never sent for a Field Twin/);
  });
  it("research use: one stated purpose, and anything materially different needs agreement again", () => {
    expect(page).toContain("to measure where its findings are right and wrong, and to tune or train the methods that make them");
    expect(page).toContain("The permission covers that purpose and no other.");
    expect(page).toContain("would need your agreement again first");
  });
  it("rights: the participant keeps theirs in what they supply, gets access to what is built, gains none in Swardus's software, and answers for imagery that is someone else's", () => {
    expect(page).toContain("You keep every right you have in the photographs and field information you supply, and in your reviews.");
    expect(page).toContain("nothing here gives you rights in them");
    expect(page).toContain("does not give permission on their behalf");
    expect(page).not.toMatch(/your Field Twins and your reviews remain yours/);
  });
  it("a security incident: investigate, contain, notify as the law requires; no unconditional promise", () => {
    expect(page).toContain("notify you as the law that applies requires");
    expect(page).not.toMatch(/we will tell you/);
  });
});

describe("a newly invited participant", () => {
  it("sees one screen: what the pilot is, what is saved and who sees it, one optional choice, one button", async () => {
    gate();
    expect(await screen.findByRole("heading", { name: "Welcome to the Swardus founding pilot" })).toBeInTheDocument();
    // Nothing of the app before the agreement.
    expect(screen.queryByText(APP)).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Free and experimental/);
    expect(text).toMatch(/observations to check, not advice/);
    expect(text).toMatch(/Your photos stay on your device/);
    expect(text).toMatch(/for corn, the build's working data \(positions, no images\)/);
    expect(text).toMatch(/founder sees your reviews and feedback, and can open your Field Twins to check results/);
    expect(text).toMatch(/Every opening is logged for you to see/);
    // Short enough to read at a glance: everything before the button is about 110 words (it was 190).
    expect(text.split("Agree & Continue")[0].trim().split(/\s+/).length).toBeLessThan(125);
    // One primary action, one optional control, a link to the whole text. No second step, no other question.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "pilot terms and privacy notice" })).toHaveAttribute("href", "/pilot-terms");
  });

  it("the research choice starts unticked, says what it allows, and is not needed to continue", async () => {
    gate();
    await agreeButton();
    expect(research().checked).toBe(false);
    expect(research().required).toBe(false);
    expect(research().closest("label")).toHaveTextContent(/^Help improve Swardus\. Let crops of my photos and my reviews be used as examples\./);
    expect(research().closest("label")).toHaveTextContent(/You can change this any time in Help/);
    fireEvent.click(await agreeButton());
    expect(await screen.findByText(APP)).toBeInTheDocument();
    // One row: these terms, the founder's access that the terms state, and no research use.
    expect(inserted).toEqual([{ terms_version: TERMS_VERSION, troubleshooting_access: true, research_use: false }]);
  });

  it("goes straight into Swardus on the one click: no second screen", async () => {
    gate();
    fireEvent.click(await agreeButton());
    expect(await screen.findByText(APP)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Welcome|terms have changed/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("ticking the research choice records it, with the same agreement", async () => {
    gate();
    await agreeButton();
    fireEvent.click(research());
    fireEvent.click(await agreeButton());
    await screen.findByText(APP);
    expect(inserted).toEqual([{ terms_version: TERMS_VERSION, troubleshooting_access: true, research_use: true }]);
  });

  it("an agreement that could not be saved leaves them on the screen, and the app closed", async () => {
    insertFails = "Failed to fetch";
    gate();
    fireEvent.click(await agreeButton());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText(APP)).toBeNull();
    expect(await agreeButton()).toBeEnabled();
    // And it works once the connection does.
    insertFails = null;
    fireEvent.click(await agreeButton());
    expect(await screen.findByText(APP)).toBeInTheDocument();
    expect(inserted).toHaveLength(1);
  });
});

describe("the gate cannot be passed without the agreement", () => {
  it("a participant who agreed to the terms in force goes straight in, and nothing is written", async () => {
    rows = [V2()];
    gate();
    expect(await screen.findByText(APP)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree & Continue" })).toBeNull();
    expect(inserted).toEqual([]);
  });

  it("an agreement that cannot be read is neither: not the app, not the agreement, and it can be tried again", async () => {
    readFails = "Failed to fetch";
    rows = [V2()];
    gate();
    expect(await screen.findByText("We could not check your pilot agreement. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText(APP)).toBeNull();
    expect(screen.queryByRole("button", { name: "Agree & Continue" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    readFails = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(APP)).toBeInTheDocument();
    expect(inserted).toEqual([]);
  });

  it("the app stays closed while the agreement is being read", () => {
    gate();
    expect(screen.queryByText(APP)).toBeNull();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("the founder is not asked, and nothing is read for them", async () => {
    gate(false);
    expect(screen.getByText(APP)).toBeInTheDocument();
    await Promise.resolve();
    expect(reads).toBe(0);
  });

  it("a database that has no agreements table yet (not updated for the pilot) does not lock the participant out", async () => {
    readFails = 'relation "public.pilot_consents" does not exist';
    gate();
    expect(await screen.findByText(APP)).toBeInTheDocument();
  });
});

describe("a participant who agreed to the earlier terms", () => {
  it("is asked again, told what is new, and nothing of the app is shown until they agree", async () => {
    rows = [V1({ troubleshooting_access: false, research_use: false })];
    gate();
    expect(await screen.findByRole("heading", { name: "The pilot terms have changed" })).toBeInTheDocument();
    expect(screen.queryByText(APP)).toBeNull();
    expect(document.body.textContent).toMatch(/What is new: the founder can open your saved Field Twins \(every opening is logged\), corn Field Twins keep the build's working data, and the research choice is asked again\./);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("their earlier research choice is not carried over: the box is unticked whatever they had said", async () => {
    rows = [V1({ troubleshooting_access: true, research_use: true })];
    gate();
    await agreeButton();
    expect(research().checked).toBe(false);
    fireEvent.click(await agreeButton());
    await screen.findByText(APP);
    expect(inserted).toEqual([{ terms_version: TERMS_VERSION, troubleshooting_access: true, research_use: false }]);
  });

  it("until they agree, what they chose under the earlier terms is all that stands: nothing is written for them", async () => {
    rows = [V1({ troubleshooting_access: false })];
    const r = gate();
    await agreeButton();
    r.unmount();
    // They closed the page instead. Their newest row is still their own v1 answer: no access for the founder.
    expect(inserted).toEqual([]);
    expect(rows.at(-1)).toMatchObject({ terms_version: "pilot-2026-11-v1", troubleshooting_access: false });
  });
});

describe("what a row means", () => {
  it("only an agreement to the terms in force lets a participant in", () => {
    expect(agreedToCurrent(null)).toBe(false);
    expect(agreedToCurrent(V1({ troubleshooting_access: true, research_use: true }))).toBe(false);
    expect(agreedToCurrent(V2())).toBe(true);
  });

  it("the research choice shown is the one made under the terms in force, and otherwise off", () => {
    expect(researchChoice(null)).toBe(false);
    expect(researchChoice(V1({ research_use: true }))).toBe(false);
    expect(researchChoice(V2({ research_use: true }))).toBe(true);
    expect(researchChoice(V2({ research_use: false }))).toBe(false);
  });
});

describe("Your data choices, later", () => {
  const page = () => render(<MemoryRouter><ConsentPage /></MemoryRouter>);

  it("shows the one choice as they left it, says plainly what the terms allow the founder, and offers no other switch", async () => {
    rows = [V2({ research_use: true })];
    page();
    await waitFor(() => expect(research().checked).toBe(true));
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(document.body.textContent).toMatch(/Swardus's founder can open your saved Field Twins to check results\. Every opening is listed below\. To end that, write to us or leave the pilot\./);
    expect(screen.getByRole("button", { name: /Access history/ })).toHaveAttribute("aria-expanded", "false");
    // Nothing to save until something changes.
    expect(screen.getByRole("button", { name: "Save my choice" })).toBeDisabled();
  });

  it("changing the choice writes a new row under the same terms, with the founder's access as the terms state it", async () => {
    rows = [V2({ research_use: true })];
    page();
    await waitFor(() => expect(research().checked).toBe(true));
    fireEvent.click(research());
    fireEvent.click(screen.getByRole("button", { name: "Save my choice" }));
    await waitFor(() => expect(inserted).toEqual([{ terms_version: TERMS_VERSION, troubleshooting_access: true, research_use: false }]));
  });

  it("choices that cannot be read are not shown as unticked: the page says so and offers to try again", async () => {
    readFails = "Failed to fetch";
    rows = [V2({ research_use: true })];
    page();
    expect(await screen.findByText("Your choices could not be read just now. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save my choice" })).toBeNull();
  });
});
