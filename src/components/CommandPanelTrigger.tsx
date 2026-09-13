/**
 * The button and the keyboard shortcut that open a CommandPanel.
 *
 * Four surfaces open the same panel, so the way you open it lives here once.
 * Otherwise each page grows its own keydown listener and its own idea of what
 * the shortcut is called, and they drift.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { commandKeyLabel } from "@/lib/command-panel";

interface TriggerProps {
  onClick(): void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function CommandPanelTrigger({
  onClick,
  children,
  disabled = false,
  className,
}: TriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // rounded-[var(--radius-sm)], not rounded-md: the vendor buttons beside
        // this one are themed off the same token in index.css, and Tailwind's
        // rem-based radius drifts away from a fixed token as the root font
        // size changes.
        "flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1 text-xs",
        "border-[var(--border-strong)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]",
        "transition-colors hover:bg-[var(--bg-hover)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
      <kbd
        className={cn(
          "rounded-sm border border-[var(--border-strong)] px-1",
          "font-mono text-[0.625rem] text-[var(--text-secondary)]",
        )}
      >
        {commandKeyLabel()}
      </kbd>
    </button>
  );
}
