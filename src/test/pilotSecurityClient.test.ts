// The browser-side fixes from the security review: a link cannot swap the account someone is signed in to, error
// text in the address is never shown as-is, and telemetry error text carries no field data.
import { describe, expect, it } from "vitest";
import { acceptSessionFromUrl, storedSession, urlSession } from "@/lib/pilot/urlSession";
import { returnedAuthError } from "@/lib/pilot/authText";
import { scrub } from "@/lib/pilot/telemetry";

describe("a sign-in in the address bar", () => {
  it("is taken only on the pages sign-in links return to", () => {
    for (const p of ["/auth", "/auth/welcome", "/app", "/auth/welcome/"]) expect(acceptSessionFromUrl(new URL(`https://swardus.test${p}#access_token=x`), false)).toBe(true);
    for (const p of ["/app/twins", "/app/twins/abc", "/", "/pilot-terms", "/admin/pilot"]) expect(acceptSessionFromUrl(new URL(`https://swardus.test${p}`), false)).toBe(false);
  });
  it("never replaces an existing sign-in (M4: someone else's tokens in a link)", () => {
    urlSession.refused = false;
    expect(acceptSessionFromUrl(new URL("https://swardus.test/auth/welcome"), true)).toBe(false);
    expect(urlSession.refused).toBe(true);
  });
  it("knows when this browser is already signed in", () => {
    const store = (m: Record<string, string>) => ({ length: Object.keys(m).length, key: (i: number) => Object.keys(m)[i] ?? null, getItem: (k: string) => m[k] ?? null });
    expect(storedSession(store({ "sb-abc-auth-token": "{}" }))).toBe(true);
    expect(storedSession(store({ "swathwise.units": "metric" }))).toBe(false);
  });
});

describe("errors returned in the address", () => {
  it("are never shown word for word (L3)", () => {
    expect(returnedAuthError("?error=server_error&error_description=Your+access+expired.+Call+%2B1+555+0100", "")).not.toMatch(/Call|555/);
    expect(returnedAuthError("?error=server_error&error_description=Send+your+password+to+help%40evil.test", "")).toBe("Sign-in did not complete. Try again.");
  });
});

describe("the telemetry scrubber (L6)", () => {
  it.each([
    ["coordinates with 3 decimals", "at 38.123,-78.456 failed", /38\.123|78\.456/],
    ["comma decimals", "at 38,1234 -78,5678", /1234|5678/],
    ["degrees-minutes-seconds", "at 38°52'14\"N 76°56'02\"W", /52'14|56'02/],
    ["UTM-like digit runs", "zone 18S 331234 4312345", /331234|4312345/],
    ["file names with spaces", "could not read Back Forty.HEIC", /Back Forty/],
    ["names before a DJI file", "Hollins Farm DJI_0001.JPG unreadable", /Hollins|DJI_0001/],
    ["Windows paths", ["C:", "Users", "ryan", "Flights", "north failed"].join(String.fromCharCode(92)), /ryan|Flights/],
    ["Unix paths", "/home/ryan/flights/north failed", /ryan|flights/],
  ])("removes %s", (_label, text, leak) => {
    expect(scrub(text)!).not.toMatch(leak);
  });
  it("keeps the useful part of a message", () => {
    expect(scrub("RangeError: Array buffer allocation failed")).toBe("RangeError: Array buffer allocation failed");
  });
});
