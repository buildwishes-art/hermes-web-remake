/**
 * The current model, shown in the composer where you are about to use it.
 *
 * It replaces the sidebar's Models nav entry. That entry pointed at a settings
 * page two clicks away from the message you were writing; the model is a
 * property of the next thing you send, so it belongs next to the send button.
 *
 * Clicking it opens a small popover rather than the full picker. The common
 * move is "switch to one of the few models I actually use, on the provider I
 * am already on", and that does not need a two-column modal. The popover lists
 * the CURRENT provider's first few models — every provider is not viable here,
 * one of them serves 707 — plus the reasoning effort and a way through to the
 * full `ModelPickerDialog`, which is still the thing that knows about provider
 * setup warnings and expensive-model confirmation.
 *
 * Switching emits a slash command via `onSubmit` rather than writing config
 * directly — the same string `ModelPickerDialog` builds, and the same path the
 * terminal used, so switching mid-conversation behaves the way it always has.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { ModelPickerDialog } from "@/components/ModelPickerDialog";
import type { GatewayClient } from "@/lib/gatewayClient";
import { cn } from "@/lib/utils";

interface Props {
  /** Reports the currently selected model upward. The transcript uses it to
      name who is being ASKED while a turn is in flight — the responder is only
      known once the reply lands, and for a router combo the two differ. */
  onModelResolved?: (model: string) => void;
  gw: GatewayClient;
  sessionId: string;
  onSubmit(slashCommand: string): void;
  /** The socket is down; there is nothing to ask and nothing to switch. */
  disabled?: boolean;
  /**
   * Open the Models page. Supplied by the page, so this component and
   * ChatTranscript both stay router-free (see the note atop ChatWebPage).
   * Omitted, the picker simply shows no link out.
   */
  onOpenModelSettings?(): void;
}

interface ModelOptionProvider {
  name: string;
  slug: string;
  models?: string[];
  total_models?: number;
  is_current?: boolean;
}

interface ModelOptions {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

interface ReasoningConfig {
  value?: string;
}

/**
 * How many of the provider's models get an inline row. A short list is the
 * point of the popover; anything longer belongs behind "More models".
 */
const MAX_ROWS = 5;

/**
 * `parse_reasoning_effort` in hermes_constants.py accepts exactly these, and
 * "none" is thinking off rather than a level. An unset config reads back as
 * "medium", so there is no separate "default" row to render.
 */
const EFFORTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "none", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];

function effortLabel(value: string): string {
  return EFFORTS.find((e) => e.value === value)?.label ?? "";
}

/** `anthropic/claude-opus-4.5` reads as `claude-opus-4.5` next to its vendor. */
function modelTitle(id: string): string {
  const tail = id.slice(id.lastIndexOf("/") + 1);
  return tail || id;
}

/** One muted line naming where the model comes from. */
function modelSubtitle(id: string, provider: string): string {
  const slash = id.indexOf("/");
  const vendor = slash > 0 ? id.slice(0, slash) : "";
  return vendor && provider ? `${vendor} · ${provider}` : vendor || provider;
}

export function ComposerModelButton({
  gw,
  sessionId,
  onSubmit,
  disabled = false,
  onOpenModelSettings,
  onModelResolved,
}: Props) {
  const [options, setOptions] = useState<ModelOptions | null>(null);
  const [effort, setEffort] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "effort">("root");
  const [dialog, setDialog] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (disabled) return;
    // session_id lets the gateway layer the live agent's provider/model over
    // whatever is on disk, so the popover shows this chat rather than config.
    gw.request<ModelOptions>("model.options", { session_id: sessionId }, 10_000)
      .then((r) => setOptions(r && typeof r === "object" ? r : null))
      // A label that cannot be fetched is not worth a transcript error; the
      // button falls back to naming itself.
      .catch(() => {});
  }, [gw, sessionId, disabled]);

  const refreshEffort = useCallback(() => {
    if (disabled) return;
    gw.request<ReasoningConfig>("config.get", { key: "reasoning", session_id: sessionId }, 10_000)
      .then((r) => setEffort(String(r?.value ?? "")))
      .catch(() => {});
  }, [gw, sessionId, disabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Everything in the popover is stale by the time it is opened again — a
  // slash command, another client or the TUI can all have moved it.
  useEffect(() => {
    if (!open) return;
    refresh();
    refreshEffort();
  }, [open, refresh, refreshEffort]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const close = useCallback(() => {
    setOpen(false);
    setView("root");
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: PointerEvent) => {
      // No focus hand-back here: the pointer already went somewhere else.
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setView("root");
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  const model = String(options?.model ?? "");

  useEffect(() => {
    if (model) onModelResolved?.(model);
  }, [model, onModelResolved]);

  const provider = useMemo(() => {
    const all = options?.providers ?? [];
    const slug = String(options?.provider ?? "");
    return all.find((p) => p.slug === slug) ?? all.find((p) => p.is_current) ?? null;
  }, [options]);

  const providerLabel = provider?.name || provider?.slug || "";

  /**
   * The provider's first few models, except that the current one is always
   * among them — otherwise the check mark disappears for anyone whose model
   * sits past the cap, and the popover looks like it lost track of the model
   * its own button is naming.
   */
  const models = useMemo(() => {
    const all = (provider?.models ?? []).filter(Boolean);
    const head = all.slice(0, MAX_ROWS);
    if (model && all.includes(model) && !head.includes(model)) {
      return [model, ...all.filter((m) => m !== model)].slice(0, MAX_ROWS);
    }
    return head;
  }, [provider, model]);

  const choose = (next: string) => {
    const slug = provider?.slug ?? "";
    setOpen(false);
    setView("root");
    if (!slug || !next) return;
    // Byte-for-byte the command ModelPickerDialog emits, minus `--global`:
    // the popover is the session-scoped move, the dialog still owns persisting.
    onSubmit(`/model ${next} --provider ${slug}`);
    // The switch runs as a slash command, so the new name only exists after
    // the gateway has processed it.
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 600);
  };

  const chooseEffort = (value: string) => {
    setView("root");
    gw.request("config.set", { key: "reasoning", session_id: sessionId, value }, 10_000)
      .catch(() => {})
      // Re-read either way: a rejected set must not leave the row advertising
      // a level the agent is not using.
      .finally(() => refreshEffort());
  };

  const row = cn(
    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
    "text-[var(--text-primary)] transition-colors cursor-pointer",
    "hover:bg-[var(--bg-hover)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  );

  return (
    <div ref={containerRef} className="relative flex min-w-0 shrink">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={model ? `Model: ${model}` : "Choose a model"}
        className={cn(
          "flex min-w-0 shrink items-center gap-1 rounded-md px-2 py-1",
          "font-sans text-xs text-[var(--text-secondary)] transition-colors cursor-pointer",
          "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          open && "bg-[var(--bg-hover)] text-[var(--text-primary)]",
        )}
      >
        <span className="truncate">{model || "Model"}</span>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Model"
          // Same bottom-anchored motion as the add menu: it opens upward out
          // of the button it belongs to.
          className={cn(
            "hermes-popover-in absolute bottom-full left-0 mb-2 w-72",
            "rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]",
            "p-1 shadow-[var(--shadow-md)]",
          )}
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          {view === "root" ? (
            <>
              {/* Same arrangement as the sidebar's "Recents / View all" header
                  (SidebarRecents.tsx): a muted section label, and the escape
                  hatch to the full list as a quiet accent link beside it.
                  It used to be a full-width menu row with a chevron at the
                  bottom, which read as a sixth model rather than a way out of
                  the list. */}
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="font-sans text-xs text-[var(--text-secondary)]">
                  {providerLabel || "Models"}
                </span>
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="dialog"
                  className={cn(
                    "rounded-sm font-sans text-xs text-[var(--accent)]",
                    "transition-colors cursor-pointer hover:text-[var(--accent-hover)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  )}
                  onClick={() => {
                    // Not `close()` — focus belongs to the dialog that is about
                    // to mount, and comes back to the trigger when it unmounts.
                    setOpen(false);
                    setView("root");
                    setDialog(true);
                  }}
                >
                  More models
                </button>
              </div>

              {models.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
                  {provider ? "No models listed for this provider." : "No models available."}
                </p>
              ) : (
                models.map((m) => {
                  const current = m === model;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="menuitem"
                      aria-current={current || undefined}
                      className={row}
                      onClick={() => choose(m)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{modelTitle(m)}</span>
                        <span className="block truncate text-xs text-[var(--text-secondary)]">
                          {modelSubtitle(m, providerLabel)}
                        </span>
                      </span>
                      {current && (
                        <>
                          <Check
                            className="h-4 w-4 shrink-0 text-[var(--accent)]"
                            aria-hidden
                          />
                          <span className="sr-only">current model</span>
                        </>
                      )}
                    </button>
                  );
                })
              )}

              <div role="separator" className="my-1 h-px bg-[var(--border)]" />

              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={false}
                className={row}
                onClick={() => setView("effort")}
              >
                <span className="flex-1">Effort</span>
                <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                  {effortLabel(effort)}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]"
                  aria-hidden
                />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className={row}
                onClick={() => setView("root")}
              >
                <ChevronLeft
                  className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]"
                  aria-hidden
                />
                <span className="flex-1 font-semibold">Effort</span>
              </button>

              <div role="separator" className="my-1 h-px bg-[var(--border)]" />

              {EFFORTS.map((e) => {
                const current = e.value === effort;
                return (
                  <button
                    key={e.value}
                    type="button"
                    role="menuitem"
                    aria-current={current || undefined}
                    className={row}
                    onClick={() => chooseEffort(e.value)}
                  >
                    <span className="flex-1">{e.label}</span>
                    {current && (
                      <>
                        <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
                        <span className="sr-only">current effort</span>
                      </>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {dialog && (
        <ModelPickerDialog
          gw={gw}
          sessionId={sessionId}
          onSubmit={(command) => {
            setDialog(false);
            onSubmit(command);
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
            refreshTimer.current = setTimeout(refresh, 600);
          }}
          onClose={() => {
            setDialog(false);
            refresh();
            triggerRef.current?.focus();
          }}
          onOpenModelSettings={onOpenModelSettings}
        />
      )}
    </div>
  );
}
