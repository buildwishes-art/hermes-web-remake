/**
 * Helpers for the CommandPanel surfaces.
 *
 * Separate from the components so Fast Refresh keeps working — a file that
 * exports both a component and a plain function loses HMR for the component.
 */

import { useEffect } from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "September 2026" — the section heading for a timestamped row.
 *
 * Shared because both session pickers group by month, and two copies of this
 * is how one surface ends up saying "Sep 2026" and the other "September 2026".
 * Undated rows get a bucket rather than being dropped.
 */
export function monthGroup(startedAt?: number | null): string {
  if (!startedAt) return "Undated";
  const d = new Date(startedAt * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Mac prints the Command glyph; everywhere else the key really is Ctrl and
 * showing a Mac glyph to a Windows user is just wrong instruction.
 */
export function commandKeyLabel(): string {
  const platform =
    typeof navigator === "undefined"
      ? ""
      : `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad/i.test(platform) ? "⌘K" : "Ctrl K";
}

/**
 * Ctrl/Cmd+K opens the panel. Bound to the window rather than a container so
 * it works while focus sits in a textarea, which is where it usually is.
 *
 * `enabled` covers the surfaces that can be shortcut-opened only sometimes —
 * a disconnected gateway has nothing to list.
 */
export function useCommandPanelKey(open: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, enabled]);
}
