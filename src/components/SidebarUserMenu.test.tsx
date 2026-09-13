import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level guards for the sidebar account menu.
 *
 * Rendering this component needs the router, i18n and profile providers, and a
 * DOM test of "does the popover open" would mostly be testing React. What is
 * actually worth locking down is the set of decisions that are easy to undo by
 * accident in a later edit — every one of these was a deliberate choice, and
 * none of them fails loudly if it regresses.
 */

const SRC = readFileSync(
  fileURLToPath(new URL("./SidebarUserMenu.tsx", import.meta.url)),
  "utf8",
);

/**
 * Comments stripped. The "must not contain" assertions below are about what
 * the component *does*; the comments deliberately name the things it avoids
 * (logout, the routes it refuses to duplicate), so matching raw source would
 * fail on the very prose that documents the decision.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROUTES = readFileSync(
  fileURLToPath(new URL("../App.tsx", import.meta.url)),
  "utf8",
);

describe("every menu row points at a route that exists", () => {
  const targets = [...SRC.matchAll(/to:\s*"([^"]+)"/g)].map((m) => m[1]);

  it("finds the rows at all", () => {
    expect(targets.length).toBeGreaterThanOrEqual(5);
  });

  for (const to of [...new Set(targets)]) {
    it(`${to} is registered in BUILTIN_ROUTES_CORE`, () => {
      // A row that navigates to an unregistered path lands on the catch-all
      // and silently redirects to /sessions — it looks like a dead click.
      expect(ROUTES).toContain(`"${to}":`);
    });
  }
});

describe("the menu owns no settings of its own", () => {
  /**
   * The rows report state and hand off to the page that owns it. A row that
   * wrote state here would be a second place to change the same setting, and
   * two places drift.
   *
   * The one action this menu carries — restart — is deliberately not a
   * setting: it goes through the shared `runAction`, not a bespoke API call.
   */
  it("rows navigate rather than mutate", () => {
    expect(SRC).toContain("navigate(to)");
    expect(CODE).not.toMatch(/api\.(set|update|put|post|delete)/i);
  });

  /**
   * Restart drops connected channels and interrupts live sessions. The click
   * must open the confirmation, never fire the action — an icon button with
   * no label is exactly the kind of control people hit by accident.
   */
  it("never restarts straight from the click handler", () => {
    const onClick = CODE.match(/onClick=\{\(\) => setRestartOpen\(true\)\}/);
    expect(onClick, "the restart button must only open the dialog").not.toBeNull();
    // `runAction("restart")` may appear only inside the dialog's onConfirm.
    const calls = [...CODE.matchAll(/runAction\("restart"\)/g)];
    expect(calls.length, "exactly one restart call site, behind the dialog").toBe(1);
    expect(CODE).toContain("onConfirm={() => {");
  });

  it("reuses the shared confirmation copy", () => {
    // A second sentence describing a disruptive action is how one of the two
    // ends up understating what it does.
    expect(SRC).toContain("GatewayRestartConfirm");
    expect(CODE).not.toContain("ConfirmDialog");
  });

  it("blocks the button while another system action is running", () => {
    expect(CODE).toContain("disabled={isBusy}");
  });

  /**
   * The restart control belongs to the always-visible trigger row, not to the
   * popover. Two structural facts hold it there, and both are easy to undo by
   * accident:
   *
   *   1. it is rendered before the `{open && (` block, i.e. outside the menu;
   *   2. it is a SIBLING of the menu-toggle button. A <button> cannot legally
   *      contain another <button> — nesting them yields invalid markup and a
   *      control the keyboard cannot reach on its own.
   */
  it("sits in the trigger row, outside the popover", () => {
    const restartAt = CODE.indexOf("setRestartOpen(true)");
    // Anchored on the popover's role rather than its mount guard: the guard
    // grew a `closing` term for the exit animation, and this test is about
    // where the restart button sits, not how the panel is gated.
    const popoverAt = CODE.indexOf('role="menu"');
    expect(restartAt, "restart button not found").toBeGreaterThan(-1);
    expect(popoverAt, "popover block not found").toBeGreaterThan(-1);
    expect(restartAt, "restart must render before the popover block").toBeLessThan(
      popoverAt,
    );
  });

  /**
   * The panel animates out, which only works if the node outlives the state
   * change. `{open && ...}` would unmount it before a frame could play.
   */
  it("stays mounted through its exit animation", () => {
    expect(CODE).toContain("{(open || closing) && (");
    expect(CODE, "exit animation class must be applied").toContain("hermes-menu-out");
    expect(CODE, "enter animation class must be applied").toContain("hermes-menu-in");
  });

  it("clears the exit timer on unmount", () => {
    expect(CODE).toMatch(/clearTimeout\(exitTimer\.current\)/);
  });

  /**
   * The JS unmount delay and the CSS animation length are the same duration
   * expressed twice. If they drift, the panel either vanishes mid-animation
   * or lingers as a dead node — both silent.
   */
  it("EXIT_MS matches --duration-fast in tokens.css", () => {
    const tokens = readFileSync(
      fileURLToPath(new URL("../styles/tokens.css", import.meta.url)),
      "utf8",
    );
    const cssMs = tokens.match(/--duration-fast:\s*(\d+)ms/);
    const jsMs = CODE.match(/const EXIT_MS = (\d+);/);
    expect(cssMs, "--duration-fast not found in tokens.css").toBeTruthy();
    expect(jsMs, "EXIT_MS not found").toBeTruthy();
    expect(Number(jsMs![1])).toBe(Number(cssMs![1]));
  });

  it("does not nest the restart button inside the menu toggle", () => {
    // The toggle's own element must close before the restart button opens.
    const toggleClose = CODE.indexOf("</button>");
    const restartAt = CODE.indexOf("setRestartOpen(true)");
    expect(toggleClose).toBeGreaterThan(-1);
    expect(toggleClose, "the toggle button must close first").toBeLessThan(restartAt);
  });

  /**
   * Signing out stays with `AuthWidget`, which POSTs to /auth/logout and
   * handles the redirect. An `<a href="/auth/logout">` here would be a GET,
   * which is both wrong and a security-relevant flow implemented twice.
   */
  it("does not re-implement logout", () => {
    expect(CODE).not.toMatch(/auth\/logout/);
    expect(CODE).not.toMatch(/LogOut/);
  });

  /**
   * A destination belongs to the nav or to this menu, never both.
   *
   * The list is read out of App.tsx rather than written here. It used to be
   * hardcoded as Sessions / Models / Skills / Chat, and went stale the moment
   * those pills moved: Sessions is reached from the Recents header now, and
   * Models from the composer — so the guard was failing an account-menu row
   * that had become the only way to reach the page.
   */
  it("does not duplicate primary navigation", () => {
    const navPaths = [...ROUTES.matchAll(/path:\s*"(\/[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(navPaths.length, "no nav paths parsed out of App.tsx").toBeGreaterThan(3);

    for (const path of navPaths) {
      expect(CODE, `"${path}" is a nav pill; it must not also be an account-menu row`)
        .not.toContain(`"${path}"`);
    }
  });
});

describe("accessibility contract", () => {
  it("declares the popover relationship", () => {
    expect(SRC).toContain('aria-haspopup="menu"');
    expect(SRC).toContain("aria-expanded={open}");
    expect(SRC).toContain('role="menu"');
    expect(SRC).toContain('role="menuitem"');
  });

  it("closes on Escape and returns focus to the trigger", () => {
    expect(SRC).toContain('e.key === "Escape"');
    expect(SRC).toContain("triggerRef.current?.focus()");
  });

  it("gives the collapsed rail an accessible name for the trigger", () => {
    // Collapsed, the label is visually hidden — without this the button is
    // announced as an empty control.
    expect(SRC).toContain("aria-label={collapsed ? workspace : undefined}");
  });

  it("never lets colour be the only carrier of state", () => {
    // `valueTone` colours the gateway value, but the value's own text ("Off",
    // "Running") is what actually says it.
    expect(SRC).toContain("valueTone");
    expect(SRC).toContain("row.valueTone ?? ");
  });
});
