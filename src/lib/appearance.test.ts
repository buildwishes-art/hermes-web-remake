// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyAppearance,
  initAppearance,
  nextAppearance,
  readAppearance,
  type AppearanceMode,
} from "./appearance";

/**
 * The contract that matters: "system" must stamp *nothing*. That absence is
 * what lets the `prefers-color-scheme` block in tokens.css apply, and what
 * keeps the choice tracking the OS afterwards instead of freezing at whatever
 * it happened to be when the user picked it.
 */

const KEY = "hermes-appearance";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("cycle order", () => {
  it("steps System -> Light -> Dark and wraps", () => {
    expect(nextAppearance("system")).toBe("light");
    expect(nextAppearance("light")).toBe("dark");
    expect(nextAppearance("dark")).toBe("system");
  });
});

describe("applying a mode", () => {
  it("stamps nothing for system, so the OS preference wins", () => {
    applyAppearance("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyAppearance("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("stamps the explicit choices", () => {
    for (const mode of ["light", "dark"] as AppearanceMode[]) {
      applyAppearance(mode);
      expect(document.documentElement.getAttribute("data-theme")).toBe(mode);
    }
  });
});

describe("reading the stored choice", () => {
  it("defaults to system when nothing is stored", () => {
    expect(readAppearance()).toBe("system");
  });

  it("defaults to system when the stored value is junk", () => {
    localStorage.setItem(KEY, "chartreuse");
    expect(readAppearance()).toBe("system");
  });

  it("returns a stored mode", () => {
    localStorage.setItem(KEY, "light");
    expect(readAppearance()).toBe("light");
  });

  /**
   * Private windows and webviews with site data blocked throw on access
   * rather than returning null. A colour preference must never stop the
   * dashboard booting.
   */
  it("survives storage that throws instead of returning null", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    });
    expect(() => readAppearance()).not.toThrow();
    expect(readAppearance()).toBe("system");
    expect(() => initAppearance()).not.toThrow();
  });
});

describe("boot", () => {
  it("applies the stored choice before anything renders", () => {
    localStorage.setItem(KEY, "dark");
    initAppearance();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
