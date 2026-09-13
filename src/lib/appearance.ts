/**
 * Light / dark / system appearance.
 *
 * Modelled on the reference's account-menu control: one row that cycles
 * System → Light → Dark in place, so you can step through and watch the page
 * change without the menu closing under you.
 *
 * "System" deliberately stamps nothing on the root element — that is what lets
 * the `prefers-color-scheme` block in tokens.css apply, and what makes the
 * choice track the OS afterwards instead of freezing at whatever it was when
 * you picked it.
 *
 * This replaces nothing: the old multi-theme system was deleted, and the
 * palette is a fixed pair now rather than a set of skins.
 */

import { useCallback, useEffect, useState } from "react";

export type AppearanceMode = "system" | "light" | "dark";

const STORAGE_KEY = "hermes-appearance";
const ORDER: readonly AppearanceMode[] = ["system", "light", "dark"];

function isMode(value: unknown): value is AppearanceMode {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Reads the stored choice. Storage throws outright in some contexts (private
 * windows, embedded webviews with site data blocked), and a dashboard must not
 * fail to boot over a colour preference.
 */
export function readAppearance(): AppearanceMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

function persist(mode: AppearanceMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // A preference that cannot be remembered is still worth honouring now.
  }
}

/** Stamps the root element. Exported so the boot path can run it before paint. */
export function applyAppearance(mode: AppearanceMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

export function nextAppearance(mode: AppearanceMode): AppearanceMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
}

/**
 * Applied at import time, before React renders, so the first paint is already
 * the right colour. Without this the page flashes dark then corrects itself.
 */
export function initAppearance(): void {
  applyAppearance(readAppearance());
}

export function useAppearance() {
  const [mode, setMode] = useState<AppearanceMode>(readAppearance);

  useEffect(() => {
    applyAppearance(mode);
    persist(mode);
  }, [mode]);

  const cycle = useCallback(() => setMode(nextAppearance), []);

  return { mode, cycle };
}
