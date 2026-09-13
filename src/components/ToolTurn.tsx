import { useState } from "react";
import { ChevronRight, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A tool call in the transcript: one quiet line, openable.
 *
 * It used to render as a bordered card with the whole raw invocation in
 * monospace, so a turn that called three tools pushed the actual answer off
 * screen. A tool call is scaffolding — worth being able to inspect, not worth
 * the room it was taking. Collapsed it states what ran; opened it shows the
 * arguments it ran with and what came back.
 *
 * Nothing here changes colour on click. The previous block let the browser
 * paint a selection highlight across the code, which read as a state change
 * the component did not actually have.
 */

/** `panel_discuss {"question":"…","models":[…]}` → name and argument blob. */
function split(text: string): { name: string; args: string } {
  const trimmed = (text || "").trim();
  const brace = trimmed.indexOf("{");
  if (brace === -1) return { name: trimmed, args: "" };
  return { name: trimmed.slice(0, brace).trim(), args: trimmed.slice(brace).trim() };
}

/** Pretty-print when the argument blob is JSON; otherwise hand it back as-is. */
function formatArgs(args: string): string {
  if (!args) return "";
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

/** A one-line gist for the collapsed row: the first argument value, truncated. */
function gist(args: string): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args);
    const first = Object.values(parsed)[0];
    const s = typeof first === "string" ? first : JSON.stringify(first);
    return s && s.length > 48 ? `${s.slice(0, 48)}…` : s || "";
  } catch {
    return "";
  }
}

export function ToolTurn({
  text,
  running = false,
  output,
}: {
  text: string;
  running?: boolean;
  /** Result text, when the surface has it. Absent while the call is in flight. */
  output?: string;
}) {
  const [open, setOpen] = useState(false);
  const { name, args } = split(text);
  const summary = gist(args);
  const hasDetail = Boolean(args || output);

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className={cn(
          "group flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-1",
          "text-left text-xs text-[var(--text-tertiary)]",
          "transition-colors hover:text-[var(--text-secondary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          !hasDetail && "cursor-default",
        )}
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" aria-hidden />
        ) : (
          <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}

        <span className="font-mono-ui shrink-0 text-[var(--text-secondary)]">{name}</span>
        {summary && <span className="min-w-0 truncate">{summary}</span>}

        {hasDetail && (
          <ChevronRight
            className={cn(
              "ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
              open && "rotate-90",
            )}
            aria-hidden
          />
        )}
      </button>

      {open && hasDetail && (
        <div className="mt-1 flex flex-col gap-2 pl-5">
          {args && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                Input
              </p>
              {/* The well that holds what went in. --bg-tertiary is the token
                  DESIGN.md reserves for inputs and wells, so this reads as the
                  same kind of surface as a text field rather than inventing a
                  shade of its own. */}
              <pre
                className={cn(
                  "overflow-x-auto rounded-[var(--radius-sm)] p-2",
                  "bg-[var(--bg-tertiary)] font-mono text-[11px] leading-relaxed",
                  "text-[var(--text-secondary)]",
                )}
              >
                {formatArgs(args)}
              </pre>
            </div>
          )}

          {output && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                Output
              </p>
              {/* Body text, not terminal green. The output of a tool is prose
                  the reader has to read; colouring it like a console makes it
                  louder than the answer it supports. */}
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
