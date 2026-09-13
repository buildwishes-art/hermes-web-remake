/**
 * The composer's "+" — one entry point for everything you can add to a
 * message, replacing the lone paperclip.
 *
 * Only rows that do something are here. The reference menu this is modelled on
 * also carries Add to project, Design brief, Workflows, Research and Web
 * search; those are that product's features, and stubbing them out as dead
 * rows would make the menu look richer while making it worse to use.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Plus, Slash } from "lucide-react";

import { cn } from "@/lib/utils";

interface Props {
  onAttach(): void;
  onSlash(): void;
  disabled?: boolean;
  attaching?: boolean;
}

/** Mac prints the Control glyph; elsewhere the key is spelled out. */
function attachShortcutLabel(): string {
  const platform =
    typeof navigator === "undefined"
      ? ""
      : `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad/i.test(platform) ? "⌃U" : "Ctrl+U";
}

export function ComposerAddMenu({
  onAttach,
  onSlash,
  disabled = false,
  attaching = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  /**
   * Ctrl/Cmd+U attaches without opening the menu. The row advertises the
   * shortcut, so it has to work from the composer rather than only from here.
   */
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        setOpen(false);
        onAttach();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, onAttach]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const row = cn(
    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
    "text-[var(--text-primary)] transition-colors cursor-pointer",
    "hover:bg-[var(--bg-hover)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  );

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to message"
        title="Add to message"
        className={cn(
          "grid h-9 w-9 place-items-center rounded-full",
          "text-[var(--text-secondary)] transition-colors cursor-pointer",
          "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          open && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
        )}
      >
        {attaching ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Plus className="h-4 w-4" aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Add to message"
          // Fades up 4px, matching the reference's menus and the model
          // popover beside it. Not the account menu's unroll: that one grows
          // out of the row it is attached to; this floats over a toolbar.
          className={cn(
            "hermes-popover-in absolute bottom-full left-0 mb-2 w-64",
            "rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]",
            "p-1 shadow-[var(--shadow-md)]",
          )}
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          <button type="button" role="menuitem" className={row} onClick={run(onAttach)}>
            <Paperclip className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
            <span className="flex-1">Add files or photos</span>
            <span className="shrink-0 font-mono text-xs text-[var(--text-tertiary)]">
              {attachShortcutLabel()}
            </span>
          </button>

          <button type="button" role="menuitem" className={row} onClick={run(onSlash)}>
            <Slash className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
            <span className="flex-1">Slash commands</span>
            <span className="shrink-0 font-mono text-xs text-[var(--text-tertiary)]">/</span>
          </button>
        </div>
      )}
    </div>
  );
}
