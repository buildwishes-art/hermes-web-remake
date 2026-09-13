import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TERMINAL_BACKGROUND, TERMINAL_FOREGROUND } from "./terminal";

/**
 * `tokens.css` is the single source of truth for the surface. Two things can
 * still drift away from it, and both are silent failures on screen:
 *
 *   1. the font literals in `index.css`, which cannot reference tokens.css
 *      without closing a `@theme inline` reference cycle;
 *   2. `terminal.ts`, which exists because xterm.js is canvas-rendered and
 *      cannot read a CSS custom property.
 *
 * Everything else here guards the contrast floors the design depends on.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const TOKENS = read("./tokens.css");
const DECL = /--([\w-]+)\s*:\s*([^;]+);/g;
const INDEX = read("../index.css");

const ROOT = TOKENS.slice(TOKENS.indexOf(":root"), TOKENS.indexOf("@media"));

function token(name: string): string {
  const m = ROOT.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} not found in tokens.css`);
  return m[1].trim();
}

/**
 * Pulls the declarations out of one rule by its selector. The light palette
 * lives in two blocks — one for the explicit `[data-theme="light"]` choice and
 * one inside a `prefers-color-scheme` query for "system" — because a media
 * query cannot be folded into a selector list.
 */
function declarations(selector: string): Record<string, string> {
  const at = TOKENS.indexOf(selector);
  if (at < 0) throw new Error(`${selector} not found in tokens.css`);
  const open = TOKENS.indexOf("{", at);
  const close = TOKENS.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of TOKENS.slice(open + 1, close).matchAll(DECL)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const LIGHT = declarations(':root[data-theme="light"]');
const LIGHT_SYSTEM = declarations(
  ':root:not([data-theme="dark"]):not([data-theme="light"])',
);
const light = (name: string): string => {
  const v = LIGHT[name];
  if (!v) throw new Error(`--${name} not found in the light palette`);
  return v;
};

/** Collapse whitespace so a wrapped font stack compares equal to a flat one. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("tokens.css defines the surface", () => {
  const required = [
    "bg-primary", "bg-secondary", "bg-tertiary", "bg-hover",
    "text-primary", "text-secondary", "text-tertiary",
    "accent", "accent-hover",
    "border", "border-strong", "border-light",
    "success", "warning", "danger",
  ];

  for (const name of required) {
    it(`--${name} is a hex colour`, () => {
      expect(token(name)).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }
});

describe("index.css font literals match tokens.css", () => {
  /**
   * These are duplicated deliberately. `@theme inline` defines
   * `--font-sans: var(--theme-font-sans)`, so `--theme-font-sans` must NOT
   * point back at `--font-sans` — that cycle drops both to the browser
   * default, which looks like "the theme didn't load" rather than an error.
   */
  const pairs: Array<[string, string]> = [
    ["font-sans", "theme-font-sans"],
    ["font-mono", "theme-font-mono"],
    ["font-display", "theme-font-display"],
  ];

  for (const [inTokens, inIndex] of pairs) {
    it(`--${inIndex} equals --${inTokens}`, () => {
      const m = INDEX.match(new RegExp(`--${inIndex}\\s*:\\s*([^;]+);`));
      expect(m, `--${inIndex} not found in index.css`).not.toBeNull();
      expect(flat(m![1])).toBe(flat(token(inTokens)));
    });
  }

  it("never points --theme-font-* back at --font-*, which would cycle", () => {
    for (const [, inIndex] of pairs) {
      const m = INDEX.match(new RegExp(`--${inIndex}\\s*:\\s*([^;]+);`));
      expect(m![1]).not.toMatch(/var\(--font-/);
    }
  });

  it("fetches no webfont — the dashboard must render offline", () => {
    // A @font-face with a local /fonts path is fine; an http(s) URL is not.
    expect(INDEX).not.toMatch(/@import\s+url\(["']?https?:/);
    expect(INDEX).not.toMatch(/src:\s*url\(["']?https?:/);
  });
});

describe("terminal.ts matches the palette", () => {
  it("background is --bg-primary", () => {
    expect(TERMINAL_BACKGROUND.toLowerCase()).toBe(token("bg-primary").toLowerCase());
  });
  it("foreground is --text-primary", () => {
    expect(TERMINAL_FOREGROUND.toLowerCase()).toBe(token("text-primary").toLowerCase());
  });
});

describe("contrast floors hold", () => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it("body text clears 4.5:1 on every surface it lands on", () => {
    for (const bg of ["bg-primary", "bg-secondary"]) {
      expect(ratio(token("text-primary"), token(bg)), `text-primary on ${bg}`)
        .toBeGreaterThanOrEqual(4.5);
      expect(ratio(token("text-secondary"), token(bg)), `text-secondary on ${bg}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("control boundaries clear the 3:1 non-text floor (WCAG 1.4.11)", () => {
    for (const bg of ["bg-primary", "bg-secondary", "bg-tertiary"]) {
      expect(ratio(token("border-strong"), token(bg)), `border-strong on ${bg}`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("accent is readable as text, not merely as decoration", () => {
    expect(ratio(token("accent"), token("bg-secondary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("status colours are readable on the surface they appear on", () => {
    for (const name of ["success", "warning", "danger"]) {
      expect(ratio(token(name), token("bg-secondary")), name)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * Records a real limit instead of hiding it: --text-tertiary sits under the
   * body floor by design and is metadata-only. The guard is that nobody
   * quietly promotes it to body use.
   */
  it("keeps text-tertiary in the metadata band, not the body band", () => {
    const r = ratio(token("text-tertiary"), token("bg-secondary"));
    expect(r).toBeLessThan(4.5);
    expect(r).toBeGreaterThanOrEqual(3);
  });

  /**
   * The light palette is held to exactly the same floors as the dark one.
   * A second palette is the easiest place for contrast to quietly rot, since
   * whoever is working in dark mode never sees it.
   */
  describe("light palette", () => {
    const SURFACES = ["bg-primary", "bg-secondary", "bg-tertiary", "bg-hover"];

    it("body text clears 4.5:1 on every surface", () => {
      for (const bg of SURFACES) {
        expect(ratio(light("text-primary"), light(bg)), `text-primary on ${bg}`)
          .toBeGreaterThanOrEqual(4.5);
        expect(ratio(light("text-secondary"), light(bg)), `text-secondary on ${bg}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    it("control boundaries clear the 3:1 non-text floor (WCAG 1.4.11)", () => {
      for (const bg of SURFACES) {
        expect(ratio(light("border-strong"), light(bg)), `border-strong on ${bg}`)
          .toBeGreaterThanOrEqual(3);
      }
    });

    it("accent and status colours are readable, not merely decorative", () => {
      for (const name of ["accent", "success", "warning", "danger"]) {
        expect(ratio(light(name), light("bg-secondary")), name)
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps text-tertiary in the same metadata band as the dark side", () => {
      const r = ratio(light("text-tertiary"), light("bg-primary"));
      expect(r).toBeLessThan(4.5);
      expect(r).toBeGreaterThanOrEqual(3);
    });

    /**
     * The two light blocks exist only because a media query cannot join a
     * selector list. Nothing in CSS keeps them in step, so this does.
     */
    it("the explicit and system-preference blocks are identical", () => {
      expect(LIGHT_SYSTEM).toEqual(LIGHT);
    });

    it("overrides every colour the dark palette defines", () => {
      const colour = /^#[0-9a-f]{6}$/i;
      const darkColours = Object.entries(declarations(":root"))
        .filter(([, v]) => colour.test(v))
        .map(([k]) => k);
      expect(darkColours.length).toBeGreaterThan(10);
      for (const name of darkColours) {
        expect(LIGHT, `--${name} has no light value`).toHaveProperty(name);
      }
    });
  });
});
