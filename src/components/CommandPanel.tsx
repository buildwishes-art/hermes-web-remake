/**
 * CommandPanel — the searchable master/detail overlay used for picking things:
 * a session to resume, a model to switch to, a skill to inspect.
 *
 * One component rather than four dialogs. The surfaces differ only in what
 * they list and what the detail pane shows, and four near-identical pickers is
 * how three of them end up with subtly different keyboard behaviour.
 *
 * Keyboard is the point, not decoration:
 *   ↑ / ↓   move the highlight (and scroll it into view)
 *   Enter   choose the highlighted row
 *   Esc     close without choosing
 *
 * The list is a `listbox` owned by the search input via `aria-activedescendant`
 * — focus never leaves the input, so typing and navigating are the same
 * gesture. A roving `tabindex` across rows would force a tab out of the field
 * before the arrows did anything.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PanelItem {
  id: string;
  title: string;
  /** Small chip after the title — folder, category, provider. */
  badge?: string;
  /** Right-aligned, quiet — a date or a count. */
  meta?: string;
  /** Section header. Items with the same group render under one heading. */
  group?: string;
  /** Extra text the search should match but the row should not show. */
  keywords?: string;
}

export interface PanelFilter {
  id: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  placeholder?: string;
  items: PanelItem[];
  filters?: PanelFilter[];
  activeFilter?: string;
  onFilterChange?(id: string): void;
  onSelect(item: PanelItem): void;
  /** Right pane for the highlighted row. Omit for a single-column panel. */
  renderDetail?(item: PanelItem): ReactNode;
  /** Footer hint for Enter — "resume", "switch", "open". */
  confirmLabel?: string;
  loading?: boolean;
  emptyLabel?: string;
}

/**
 * Mounting gate. The body holds all the state, so mounting it fresh on open is
 * what resets the query and the highlight — no effect that writes state on
 * render, and no chance of reopening onto someone else's half-typed search.
 */
export function CommandPanel(props: Props) {
  if (!props.open) return null;
  return <PanelBody {...props} />;
}

function PanelBody({
  onClose,
  title,
  placeholder = "Search…",
  items,
  filters,
  activeFilter,
  onFilterChange,
  onSelect,
  renderDetail,
  confirmLabel = "select",
  loading = false,
  emptyLabel = "Nothing to show",
}: Props) {
  const [query, setQuery] = useState("");
  /** May exceed the filtered length after a search narrows the list; every
   *  read clamps, so there is nothing to correct in an effect. */
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      `${i.title} ${i.badge ?? ""} ${i.meta ?? ""} ${i.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  // Group in list order so the caller controls sequence; a Map keeps
  // insertion order, which a plain object would not guarantee for numeric-ish
  // keys.
  const groups = useMemo(() => {
    const out = new Map<string, PanelItem[]>();
    for (const item of filtered) {
      const key = item.group ?? "";
      const list = out.get(key);
      if (list) list.push(item);
      else out.set(key, [item]);
    }
    return [...out.entries()];
  }, [filtered]);

  const active = filtered[Math.min(cursor, filtered.length - 1)];

  // Focus after paint so the field is actually in the document.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    // Optional-called: keeping the highlighted row in view is a nicety, and
    // environments without it (jsdom, older headless runtimes) must not take
    // the whole picker down over a scroll hint.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, filtered.length]);

  const choose = useCallback(
    (item: PanelItem | undefined) => {
      if (!item) return;
      onSelect(item);
      onClose();
    },
    [onSelect, onClose],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      style={{ zIndex: "var(--z-modal)" }}
      // Backdrop only: a click that started inside the panel and drifted out
      // during a text selection must not close it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "flex max-h-[80vh] w-full max-w-[960px] flex-col overflow-hidden",
          "rounded-lg border border-[var(--border)] bg-[var(--bg-primary)]",
          "shadow-[var(--shadow-md)]",
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <h2
            id={titleId}
            className="font-display text-2xl font-light text-[var(--text-primary)]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-md",
              "text-[var(--text-secondary)] transition-colors",
              "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            )}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2",
              "border-[var(--border-strong)] bg-[var(--bg-secondary)]",
              "focus-within:ring-2 focus-within:ring-[var(--accent)]",
            )}
          >
            <Search className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label={placeholder}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
              className="w-full border-none bg-transparent text-[var(--text-primary)] outline-none"
            />
          </div>
        </div>

        {filters && filters.length > 0 && (
          <div className="flex flex-wrap gap-2 px-6 pt-3" role="group" aria-label="Filters">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                disabled={f.disabled}
                aria-pressed={activeFilter === f.id}
                onClick={() => onFilterChange?.(f.id)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  activeFilter === f.id
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex min-h-0 flex-1 border-t border-[var(--border-light)]">
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={title}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto py-2",
              renderDetail && "border-r border-[var(--border-light)]",
            )}
          >
            {loading ? (
              <p className="px-6 py-4 text-sm text-[var(--text-secondary)]">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="px-6 py-4 text-sm text-[var(--text-secondary)]">{emptyLabel}</p>
            ) : (
              groups.map(([group, rows]) => (
                <div key={group || "_"}>
                  {group && (
                    <p className="px-6 pt-3 pb-1 text-xs text-[var(--text-secondary)]">{group}</p>
                  )}
                  {rows.map((item) => {
                    const index = filtered.indexOf(item);
                    const isActive = item.id === active?.id;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-${item.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive}
                        // Pointer moves the highlight so the detail pane
                        // follows the mouse, matching the keyboard.
                        onMouseMove={() => setCursor(index)}
                        onClick={() => choose(item)}
                        className={cn(
                          "mx-2 flex cursor-pointer items-center gap-3 rounded-md px-4 py-2",
                          isActive ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span className="shrink-0 rounded-sm bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                            {item.badge}
                          </span>
                        )}
                        {item.meta && (
                          <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                            {item.meta}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {renderDetail && (
            <div className="min-h-0 w-[38%] shrink-0 overflow-y-auto px-6 py-4">
              {active ? (
                renderDetail(active)
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">Nothing selected</p>
              )}
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-4 px-6 py-3",
            "border-t border-[var(--border-light)] text-xs text-[var(--text-secondary)]",
          )}
        >
          <span className="flex items-center gap-1">
            <Key>Up</Key>
            <Key>Down</Key>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Key>Esc</Key>
            close
            <Key>Enter</Key>
            {confirmLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      className={cn(
        "rounded-sm border border-[var(--border-strong)] bg-[var(--bg-secondary)]",
        "px-1.5 py-0.5 font-mono text-[0.6875rem] text-[var(--text-primary)]",
      )}
    >
      {children}
    </kbd>
  );
}

