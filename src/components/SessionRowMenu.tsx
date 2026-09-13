import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * The ⋯ overflow on a session row: rename, export, copy id, delete.
 *
 * Every entry maps to an endpoint that already exists — `renameSession`,
 * `exportSessionUrl`, `deleteSession`. There is deliberately no "Archive":
 * the Sessions page shows an Archived count, but no archive endpoint is
 * exposed, and a menu item that silently does nothing is worse than one that
 * is absent.
 *
 * Delete confirms in place rather than through a modal. The row is small and
 * the mistake is cheap to prevent: the item turns into "Confirm delete?" and
 * only the second click destroys anything.
 */

const row = cn(
  "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm",
  "text-[var(--text-secondary)] transition-colors",
  "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
);

export function SessionRowMenu({
  sessionId,
  title,
  onRenamed,
  onDeleted,
}: {
  sessionId: string;
  title: string;
  onRenamed?: (id: string, title: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click and on Escape. Without the first, the menu survives
  // a click on the row beneath it and floats over a session it no longer
  // describes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset the destructive step whenever the menu closes, so reopening never
  // lands the pointer on a primed "Confirm delete?".
  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = useCallback(async () => {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === title) return;
    try {
      await api.renameSession(sessionId, next);
      onRenamed?.(sessionId, next);
    } catch {
      setDraft(title); // put the old name back rather than show a lie
    }
  }, [draft, title, sessionId, onRenamed]);

  const doDelete = useCallback(async () => {
    try {
      await api.deleteSession(sessionId);
      onDeleted?.(sessionId);
    } finally {
      setOpen(false);
    }
  }, [sessionId, onDeleted]);

  const copyId = useCallback(() => {
    // The shared helper, not navigator.clipboard directly: it falls back to a
    // selection-based copy when the page is not a secure context, where the
    // async API simply rejects. A repo test enforces this.
    void copyTextToClipboard(sessionId).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [sessionId]);

  if (renaming) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commitRename()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commitRename();
          if (e.key === "Escape") {
            setDraft(title);
            setRenaming(false);
          }
        }}
        aria-label="Session title"
        className={cn(
          "w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-sm",
          "border border-[var(--border-strong)] bg-[var(--bg-tertiary)]",
          "text-[var(--text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        )}
      />
    );
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          // The row underneath navigates; the ⋯ must not.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]",
          "text-[var(--text-tertiary)] transition-colors",
          "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          // The reveal lives here, not on the wrapper, because only this
          // component knows `open`. Driven from the row's `group` so twenty
          // rows don't each show a dot at rest — but an OPEN menu stays lit:
          // fading the trigger out from under a menu the reader just opened,
          // the moment the pointer drifts, is how you lose the menu.
          "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
          open && "opacity-100",
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Session actions: ${title}`}
          className={cn(
            "hermes-popover-in absolute right-0 top-full mt-1 w-44",
            "rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]",
            "p-1 shadow-[var(--shadow-md)]",
          )}
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          <button
            type="button"
            role="menuitem"
            className={row}
            onClick={(e) => {
              e.stopPropagation();
              setDraft(title);
              setRenaming(true);
              setOpen(false);
            }}
          >
            <Pencil className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Rename</span>
          </button>

          <a
            role="menuitem"
            href={api.exportSessionUrl(sessionId)}
            download
            className={row}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          >
            <Download className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Export</span>
          </a>

          <button
            type="button"
            role="menuitem"
            className={row}
            onClick={(e) => {
              e.stopPropagation();
              copyId();
            }}
          >
            {copied ? (
              <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
            ) : (
              <Copy className="h-4 w-4 shrink-0" aria-hidden />
            )}
            <span className="flex-1">{copied ? "Copied" : "Copy ID"}</span>
          </button>

          <div className="my-1 h-px bg-[var(--border-light)]" />

          <button
            type="button"
            role="menuitem"
            className={cn(row, "text-[var(--danger)] hover:text-[var(--danger)]")}
            onClick={(e) => {
              e.stopPropagation();
              if (confirming) void doDelete();
              else setConfirming(true);
            }}
          >
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{confirming ? "Confirm delete?" : "Delete"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
