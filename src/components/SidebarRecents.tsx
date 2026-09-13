/**
 * The chat launcher at the top of the sidebar: a New chat button and a short
 * list of recent conversations, with "View all" leading to the full Sessions
 * page.
 *
 * Modelled on the reference sidebar. Its mode switcher (Chat / Code / Design)
 * is deliberately absent — Hermes has one mode, and a segmented control with a
 * single option is a control that cannot do anything.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";

import { api, type SessionInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SessionRowMenu } from "@/components/SessionRowMenu";

/**
 * Broadcast when the user asks for a fresh conversation.
 *
 * A plain navigation cannot express this on its own: clicking New chat while
 * already on the chat route leaves the path unchanged, so nothing remounts and
 * the old transcript stays. The alternative — a cache-busting `?new=<n>` in
 * the URL — works but leaves that parameter on screen for the rest of the
 * session. An event says exactly what happened and leaves the address bar
 * alone.
 */
export const NEW_CHAT_EVENT = "hermes:new-chat";

/** How many recents fit before the list starts competing with the nav below. */
const RECENT_LIMIT = 5;

/**
 * How often the list re-checks for sessions that appeared while it was on
 * screen. One small request every twenty seconds is cheap enough to leave
 * running and slow enough that nobody notices it, which is the right trade for
 * a list nothing else can tell us has changed.
 */
const POLL_MS = 20_000;

export function SidebarNewChat({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();

  const start = useCallback(() => {
    onNavigate?.();
    navigate("/chat-web");
    // Dispatched synchronously. Deferring it would not buy a transcript that is
    // only now mounting the chance to hear this: React Router wraps navigation
    // in `React.startTransition`, which commits on a Scheduler macrotask —
    // strictly after the microtask queue has drained — so a listener attached
    // by that mount does not exist yet either way.
    //
    // It does not need to. The two cases are disjoint: already on /chat-web,
    // the transcript is mounted and its listener hears this; arriving from
    // anywhere else, it mounts with empty state and has nothing to reset.
    window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT));
  }, [navigate, onNavigate]);

  return (
    <div className="px-3 pt-2 pb-1">
      <button
        type="button"
        onClick={start}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5",
          "border border-[var(--border-strong)] bg-[var(--bg-secondary)]",
          "font-sans text-sm text-[var(--text-primary)]",
          "transition-colors cursor-pointer hover:bg-[var(--bg-hover)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        )}
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden />
        New chat
      </button>
    </div>
  );
}

export function SidebarRecents({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  useEffect(() => {
    let mounted = true;
    // Loads overlap — a poll can be in flight when the event fires, and the two
    // requests can come back in either order. Unmounting is not the only way a
    // response goes stale, so each request carries a sequence number and only
    // the newest one is allowed to write; without it a slow early response
    // overwrites a fast later one and the list quietly goes backwards.
    let issued = 0;
    const load = () => {
      const seq = ++issued;
      api
        // Passing `undefined` for the third argument is not an opt-out of
        // profile scoping. That parameter defaults to `getManagementProfile()`,
        // and a JS default applies to an explicitly passed `undefined`, so this
        // list is scoped to the active management profile — which is what
        // Recents should show. The argument is spelled out only to reach the
        // `order` slot behind it.
        .getSessions(RECENT_LIMIT, 0, undefined, "recent")
        .then((r) => {
          if (mounted && seq === issued) setSessions(r.sessions);
        })
        .catch(() => {
          if (mounted && seq === issued) setSessions([]);
        });
    };
    load();

    // NEW_CHAT_EVENT does not mean a new session exists yet: pressing New chat
    // only clears the transcript's session ref, and the server mints the
    // session on the first send. This refetch therefore usually returns the
    // same list — it is kept because it costs nothing and catches whatever
    // changed while the sidebar sat idle.
    window.addEventListener(NEW_CHAT_EVENT, load);

    // The poll is what actually brings a new conversation in, once the first
    // message has been sent and the session is real. It also picks up sessions
    // started from the CLI or another tab, which no event in this app reports.
    const poll = window.setInterval(load, POLL_MS);

    return () => {
      mounted = false;
      window.clearInterval(poll);
      window.removeEventListener(NEW_CHAT_EVENT, load);
    };
  }, []);

  const open = (id: string) => {
    onNavigate?.();
    navigate(`/chat-web?resume=${encodeURIComponent(id)}`);
  };

  return (
    <div className="px-3 pb-2">
      <div className="flex items-center justify-between gap-2 px-1 py-1.5">
        <span className="font-sans text-xs text-[var(--text-secondary)]">
          Recents
        </span>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            navigate("/sessions");
          }}
          className={cn(
            "rounded-sm font-sans text-xs text-[var(--accent)]",
            "transition-colors cursor-pointer hover:text-[var(--accent-hover)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
          )}
        >
          View all
        </button>
      </div>

      {sessions === null ? (
        <p className="px-1 py-1 font-sans text-xs text-[var(--text-tertiary)]">
          Loading…
        </p>
      ) : sessions.length === 0 ? (
        <p className="px-1 py-1 font-sans text-xs text-[var(--text-tertiary)]">
          No chats yet
        </p>
      ) : (
        <ul className="flex flex-col">
          {sessions.map((s) => (
            // The row is a flex pair, not a button wrapping a button: the ⋯
            // menu is interactive and nesting it inside the navigating button
            // is invalid HTML that browsers resolve by dropping one of them.
            // `group` drives the reveal — the menu is invisible until hover or
            // keyboard focus so twenty rows don't each carry a dot.
            <li
              key={s.id}
              className={cn(
                "group flex items-center gap-1 rounded-md pr-1",
                "transition-colors hover:bg-[var(--bg-hover)]",
              )}
            >
              <button
                type="button"
                onClick={() => open(s.id)}
                title={s.title?.trim() || s.id}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left",
                  "font-sans text-sm text-[var(--text-secondary)]",
                  "transition-colors cursor-pointer",
                  "group-hover:text-[var(--text-primary)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                )}
              >
                {s.title?.trim() || "Untitled session"}
              </button>

              <div>
                <SessionRowMenu
                  sessionId={s.id}
                  title={s.title?.trim() || "Untitled session"}
                  // NEW_CHAT_EVENT is this list's refetch channel, not
                  // only a new-chat signal — `load` is scoped inside the
                  // effect that registers the listener, so firing the event
                  // is how anything outside asks for a reload.
                  onRenamed={() => window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT))}
                  onDeleted={() => window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
