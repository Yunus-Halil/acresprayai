// The new-tab button, and why it looked dead.
//
// The button was wired correctly the whole time: it toggled `newTabOpen`, the
// menu rendered, React did everything asked of it. The menu was simply invisible
// — it was a child of the tab strip, and the tab strip is a horizontal scroll
// container. CSS says a box that scrolls on one axis clips the other, so an
// absolutely positioned menu hanging 36px below the top of a 40px bar was
// painted into nothing. No error, no warning, no console message. A button that
// silently does nothing is exactly the failure this codebase refuses to ship.
//
// jsdom does not lay out or clip, so no amount of rendering the component would
// catch this. What CAN be checked is the structure that caused it: the menu must
// not live inside the scroller. These are source-level assertions for that
// reason, and they are the guard that would have failed on the original code.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Newlines normalised: this repo is checked out CRLF on Windows and LF in CI,
// and a structural assertion should not depend on which.
const SRC = readFileSync(resolve(__dirname, "../pages/app/OrthomosaicViewer.tsx"), "utf8")
  .split("\r\n").join("\n");

/** The chunk of JSX from the tab bar comment to the tab-content comment. */
function tabBarSource(): string {
  const start = SRC.indexOf("{/* Browser-style tab bar */}");
  const end = SRC.indexOf("{/* Tab content */}");
  expect(start, "tab bar block not found").toBeGreaterThan(-1);
  expect(end, "tab content block not found").toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("workspace tab bar", () => {
  it("keeps the new-tab menu out of the horizontally scrolling strip", () => {
    const bar = tabBarSource();
    const scroller = bar.indexOf("overflow-x-auto");
    const menu = bar.indexOf('data-testid="new-tab-menu"');
    expect(scroller, "the tab strip should still scroll").toBeGreaterThan(-1);
    expect(menu, "the new-tab menu should still exist").toBeGreaterThan(-1);

    // The scroller closes before the + button opens. If the menu moved back
    // inside the strip, no </div> would separate the two and it would be
    // clipped into invisibility all over again.
    const closeThenButton = /<\/div>\s*<div className="relative shrink-0/.exec(bar.slice(scroller));
    expect(
      closeThenButton,
      "the scrolling strip must close before the + button and its menu",
    ).not.toBeNull();
    expect(scroller + closeThenButton!.index).toBeLessThan(menu);
  });

  it("anchors the menu to the button, not to the bar", () => {
    const bar = tabBarSource();
    // The + button and the menu share one `relative` wrapper. Without it the
    // menu positions against whatever ancestor happens to be relative next.
    expect(bar).toContain('className="relative shrink-0 self-center"');
    expect(bar).toContain('data-testid="new-tab-button"');
  });

  it("keeps the + next to the last tab rather than at the far edge of the bar", () => {
    const bar = tabBarSource();
    const scroller = bar.slice(bar.indexOf("<div className=\"h-full"), bar.indexOf("overflow-y-hidden"));
    // `flex-1` stretched the strip across the whole bar and pushed the + to the
    // right-hand edge, a screen away from the tab it adds to. The strip is
    // sized to its tabs and shrinks only when they overflow.
    expect(scroller).not.toMatch(/\bflex-1\b/);
    expect(scroller).toContain("min-w-0");
    expect(scroller).toContain("overflow-x-auto");
  });

  it("picks the menu edge from where the button actually is", () => {
    // Neither alignment works in both cases: the + normally sits near the left
    // (menu opens rightward), but a full tab strip on a narrow screen walks it
    // toward the right edge (menu must open leftward). CSS cannot flip on its
    // own, so it is measured.
    expect(SRC).toContain("const NEW_TAB_MENU_W = 224");
    expect(SRC).toMatch(/getBoundingClientRect\(\)[\s\S]{0,200}window\.innerWidth/);
    expect(tabBarSource()).toMatch(/newTabAlign === "right" \? "right-0" : "left-0"/);
    // Both entry points into the menu measure before opening.
    expect(SRC).toContain("if (!newTabOpen) alignNewTabMenu();");
    expect(SRC).toMatch(/alignNewTabMenu\(\);\s*\n\s*setNewTabOpen\(o => !o\);/);
  });

  it("closes on a click outside, not only on Escape or a second click", () => {
    expect(SRC).toContain("newTabRef");
    expect(SRC).toMatch(/document\.addEventListener\("mousedown"/);
  });

  // Ctrl+T is a reserved browser shortcut: Chrome, Edge and Firefox never
  // deliver the keydown to the page, so the old handler could not fire and
  // preventDefault prevented nothing. Pressing the advertised shortcut opened a
  // browser tab and navigated away from SwathWise. The UI promised a key it did
  // not have.
  it("does not advertise a keyboard shortcut the browser eats", () => {
    const handler = SRC.slice(SRC.indexOf("// Alt+T opens the new-tab menu"));
    expect(handler.slice(0, 1500)).not.toMatch(/ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === "t"/);
    expect(SRC).toContain('e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "t"');
  });

  it("names the shortcut in exactly one place so the label cannot drift", () => {
    expect(SRC).toContain("const NEW_TAB_SHORTCUT_LABEL");
    // Tooltip and menu footer both read the constant rather than a literal.
    expect(SRC).toContain("title={`New tab (${NEW_TAB_SHORTCUT_LABEL})`}");
    expect(SRC).toContain(">{NEW_TAB_SHORTCUT_LABEL}<");
    // And no stale "Ctrl + T" survives in anything the operator can read. The
    // comment explaining why it went is expected to keep saying "Ctrl+T".
    expect(tabBarSource()).not.toMatch(/Ctrl/);
  });

  it("does not fire the shortcut while the operator is typing", () => {
    expect(SRC).toContain("isTypingTarget(e.target)");
    expect(SRC).toMatch(/tag === "input" \|\| tag === "textarea"/);
  });

  it("gives every tab-strip control an explicit button type", () => {
    // A <button> with no type defaults to submit. None of these sit in a form
    // today, but the tab strip is a place where one silently-swallowed click
    // has already cost a day.
    const bar = tabBarSource();
    const buttons = bar.match(/<button\b/g) ?? [];
    const typed = bar.match(/type="button"/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(typed.length).toBe(buttons.length);
  });
});
