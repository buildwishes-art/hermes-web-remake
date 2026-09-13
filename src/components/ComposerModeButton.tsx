import { useEffect, useRef, useState } from "react";
import { ChevronDown, Hammer, Map } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Build / Plan selector, sitting beside the model button in the composer.
 *
 * Build is the default and the neutral case: the message goes through
 * untouched, exactly as it did before this control existed. Plan prepends a
 * short directive asking for an approach rather than an implementation.
 *
 * The steering is a prefix on the outgoing message rather than a backend flag,
 * because Hermes has no plan-mode concept to hook into — `/plan` exists in the
 * command list but carries no handler of its own. A prefix works on every
 * model and every provider, and it is visible in the transcript, so a reader
 * can see why the reply came back as a plan.
 */

export type ComposerMode = "build" | "plan";

const MODE_KEY = "hermes.composer.mode";

/** Prepended to the message when Plan is selected. Empty for Build. */
export const PLAN_DIRECTIVE =
  "Plan first: lay out the approach and the ordered steps, name the risks and " +
  "what you are unsure of, and stop there. Do not implement anything yet.\n\n";

export function readMode(): ComposerMode {
  try {
    return localStorage.getItem(MODE_KEY) === "plan" ? "plan" : "build";
  } catch {
    // Private windows throw on access. Build is the neutral default, so a
    // failed read costs the user nothing.
    return "build";
  }
}

function writeMode(mode: ComposerMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* see readMode */
  }
}

/** Apply the mode to an outgoing message. Build returns it unchanged. */
export function applyMode(text: string, mode: ComposerMode): string {
  return mode === "plan" ? PLAN_DIRECTIVE + text : text;
}

const OPTIONS: Array<{
  value: ComposerMode;
  label: string;
  hint: string;
  Icon: typeof Hammer;
}> = [
  {
    value: "build",
    label: "Build",
    hint: "Do the work",
    Icon: Hammer,
  },
  {
    value: "plan",
    label: "Plan",
    hint: "Approach and steps first, no implementation",
    Icon: Map,
  },
];

export function ComposerModeButton({
  mode,
  onChange,
  disabled = false,
}: {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0]!;
  const CurrentIcon = current.Icon;

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

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mode: ${current.label}`}
        // Matches ComposerModelButton exactly — these two sit side by side and
        // a half-matched pair reads as a bug rather than a set.
        className={cn(
          "flex min-w-0 shrink items-center gap-1 rounded-md px-2 py-1",
          "font-sans text-xs text-[var(--text-secondary)] transition-colors cursor-pointer",
          "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          open && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
          // Plan is the non-default: it changes what the model is asked to do,
          // so it stays visible at rest instead of blending into the toolbar.
          mode === "plan" && "text-[var(--accent)]",
        )}
      >
        <CurrentIcon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{current.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Mode"
          className={cn(
            "hermes-popover-in absolute bottom-full left-0 mb-2 w-56",
            "rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]",
            "p-1 shadow-[var(--shadow-md)]",
          )}
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          {OPTIONS.map(({ value, label, hint, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(value);
                writeMode(value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left",
                "transition-colors hover:bg-[var(--bg-hover)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                value === mode && "bg-[var(--bg-tertiary)]",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  value === mode ? "text-[var(--accent)]" : "text-[var(--text-secondary)]",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-[var(--text-primary)]">{label}</span>
                <span className="block text-xs text-[var(--text-secondary)]">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
