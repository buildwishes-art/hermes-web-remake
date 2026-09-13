import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Pencil, RotateCw } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * The action row under a user message: resend, edit, copy.
 *
 * Deliberately without the timestamp the reference design shows. `Turn` carries
 * no time, and `session.resume` returns messages without one either — so the
 * only clock available is this browser's, which would be right for a message
 * typed just now and wrong for every message in a transcript resumed from
 * yesterday. A label that is confidently wrong is worse than an absent one.
 *
 * Edit does not rewrite history. It puts the text back in play as a NEW turn,
 * because the transcript above it has already been answered — silently
 * changing what the user "said" would leave replies attached to words that
 * were never sent.
 */

export function UserMessageActions({
  text,
  onResend,
  disabled = false,
}: {
  text: string;
  /** Submits text as a fresh turn. Omitted while the agent is busy. */
  onResend?: (text: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const el = areaRef.current;
      el?.focus();
      // Caret at the end, not over the text: the common case is appending a
      // correction, and a select-all means the first keystroke destroys it.
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const copy = useCallback(() => {
    void copyTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  const commit = useCallback(() => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === text.trim()) return;
    onResend?.(next);
  }, [draft, text, onResend]);

  if (editing) {
    return (
      <div className="mt-1 flex w-full max-w-[80%] flex-col gap-1">
        <textarea
          ref={areaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(text);
              setEditing(false);
            }
          }}
          rows={Math.min(8, draft.split("\n").length + 1)}
          aria-label="Edit message"
          className={cn(
            "w-full resize-none rounded-lg px-3 py-2 text-sm",
            "border border-[var(--border-strong)] bg-[var(--bg-tertiary)]",
            "text-[var(--text-primary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          )}
        />
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <button
            type="button"
            onClick={commit}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-[var(--accent)] hover:bg-[var(--bg-hover)]"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(text);
              setEditing(false);
            }}
            className="rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <span className="ml-auto">Enter to send · Esc to cancel</span>
        </div>
      </div>
    );
  }

  const Btn = ({
    label,
    onClick,
    children,
  }: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)]",
        "text-[var(--text-tertiary)] transition-colors",
        "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );

  return (
    <div
      className={cn(
        "mt-1 flex items-center justify-end gap-0.5 transition-opacity",
        "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        // The copy tick must outlive the pointer leaving, or the only feedback
        // the button gives disappears before it is read.
        copied && "opacity-100",
      )}
      role="group"
      aria-label="Message actions"
    >
      {onResend && (
        <Btn label="Resend" onClick={() => onResend(text)}>
          <RotateCw className="h-3.5 w-3.5" />
        </Btn>
      )}

      {onResend && (
        <Btn
          label="Edit and resend"
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Btn>
      )}

      <Btn label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Btn>
    </div>
  );
}
