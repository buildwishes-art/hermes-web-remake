// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionInfo } from "@/lib/api";

/**
 * The sidebar chat launcher, pinned.
 *
 * Everything here is navigation or a network round trip, and both fail
 * quietly: a button that changes no URL looks like a dead control, and a list
 * that never leaves "Loading…" looks like the dashboard hung. Neither shows up
 * as an exception, so neither shows up anywhere except in a test.
 *
 * Renders go through a real MemoryRouter rather than a mocked `useNavigate`,
 * so the assertions read the location the user would actually land on —
 * including the query string, which is how the chat surface is handed a
 * session to resume.
 */

// React needs to be told this is a test renderer before anything mounts.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface SessionPage {
  sessions: SessionInfo[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * The full four-parameter shape, declared as a type rather than as unused
 * parameters on the fake. The component passes four arguments, and a mock that
 * only *declares* two types the recorded call tuple as `[number, number]` — the
 * paging/order assertion below would then pass the test run and fail `tsc` in
 * the build. Stating the signature here keeps `mock.calls` typed to all four
 * slots while the implementation names only the arguments it actually uses.
 */
type GetSessions = (
  limit: number,
  offset: number,
  profile?: string,
  order?: "created" | "recent",
) => Promise<SessionPage>;

const apiMocks = vi.hoisted(() => ({
  getSessions: vi.fn<GetSessions>(async (limit, offset) => ({
    sessions: [],
    total: 0,
    limit,
    offset,
  })),
}));

vi.mock("@/lib/api", () => ({ api: { getSessions: apiMocks.getSessions } }));

const { NEW_CHAT_EVENT, SidebarNewChat, SidebarRecents } = await import("./SidebarRecents");

let container: HTMLDivElement;
let root: Root;

/** Reports the live router location so navigation can be asserted on the URL
 *  the user would end up at, rather than on a spy that proves only that some
 *  function was called. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-probe="1">{`${pathname}${search}`}</p>;
}

async function render(ui: ReactNode, at = "/") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>,
    );
  });
}

/** The fetch settles a microtask after mount, so state lands one turn late. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const location = () => container.querySelector('[data-probe="1"]')?.textContent ?? "";

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === label,
  )!;

// `li > button`, not `li button`: the row grew a sibling ⋯ menu whose
// trigger is also a button, nested one div deeper. The direct-child
// selector keeps these helpers meaning "the row itself".
const rows = () => [...container.querySelectorAll("li > button")];
const rowLabels = () => rows().map((b) => (b.textContent ?? "").trim());

const session = (id: string, title: string | null): SessionInfo => ({
  id,
  source: "cli",
  model: null,
  title,
  started_at: 0,
  ended_at: null,
  last_active: 0,
  is_active: false,
  message_count: 0,
  tool_call_count: 0,
  input_tokens: 0,
  output_tokens: 0,
  preview: null,
});

const page = (sessions: SessionInfo[]): SessionPage => ({
  sessions,
  total: sessions.length,
  limit: 5,
  offset: 0,
});

beforeEach(() => {
  // reset, not clear: `clearAllMocks` keeps any `mockResolvedValue` a previous
  // test installed, so one test's session list would leak into the next.
  // `vi.fn(fn)` restores its factory implementation on reset.
  vi.resetAllMocks();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SidebarNewChat", () => {
  /**
   * The navigation alone is not enough. Pressing New chat while already on
   * /chat-web leaves the path unchanged, so nothing remounts and the previous
   * transcript stays on screen — the event is the half that actually clears
   * it, and it is invisible in any URL assertion.
   */
  it("navigates to the chat route and announces the reset", async () => {
    const heard = vi.fn();
    window.addEventListener(NEW_CHAT_EVENT, heard);
    try {
      await render(<SidebarNewChat />);
      await act(async () => button("New chat").click());

      expect(location()).toBe("/chat-web");
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(NEW_CHAT_EVENT, heard);
    }
  });

  /** On mobile the sidebar is a drawer over the page; without this callback it
   *  stays open on top of the surface it just navigated to. */
  it("lets the drawer close itself before leaving", async () => {
    const onNavigate = vi.fn();
    await render(<SidebarNewChat onNavigate={onNavigate} />);
    await act(async () => button("New chat").click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("SidebarRecents", () => {
  it("sends View all to the full Sessions page", async () => {
    await render(<SidebarRecents />);
    await settle();
    await act(async () => button("View all").click());
    expect(location()).toBe("/sessions");
  });

  /** A sidebar ordered by creation date puts the oldest conversations at the
   *  top, which is the opposite of what "Recents" claims. */
  it("asks for a short, recency-ordered slice", async () => {
    await render(<SidebarRecents />);
    await settle();
    const call = apiMocks.getSessions.mock.calls[0]!;
    expect(call[0]).toBeLessThanOrEqual(5);
    expect(call[1]).toBe(0);
    // Left undefined so the parameter's own default — the active management
    // profile — applies. This is scoping, not an opt-out of it.
    expect(call[2]).toBeUndefined();
    expect(call[3]).toBe("recent");
  });

  /**
   * An untitled session is the common case for a chat that was never named.
   * Falling through to the raw title would render a button with no text — a
   * clickable blank line that neither reads nor announces as anything.
   */
  it("labels every row, falling back for blank titles", async () => {
    apiMocks.getSessions.mockResolvedValue(
      page([
        session("a", "Deploy notes"),
        session("b", null),
        session("c", "   "),
      ]),
    );
    await render(<SidebarRecents />);
    await settle();

    expect(rowLabels()).toEqual(["Deploy notes", "Untitled session", "Untitled session"]);
  });

  /** The id travels in a query string, so anything unescaped in it silently
   *  truncates the value the chat surface reads back. */
  it("hands the row's id to the chat route, percent-encoded", async () => {
    apiMocks.getSessions.mockResolvedValue(page([session("2026/01 chat&x", "Deploy notes")]));
    await render(<SidebarRecents />);
    await settle();
    await act(async () => (rows()[0] as HTMLButtonElement).click());

    expect(location()).toBe("/chat-web?resume=2026%2F01%20chat%26x");
  });

  /**
   * A failed fetch must resolve to an answer, not stay pending. A sidebar
   * frozen on "Loading…" is indistinguishable from a hung dashboard, and the
   * failure it is hiding is usually a 401 the user could act on.
   */
  it("settles on the empty state when the fetch rejects", async () => {
    apiMocks.getSessions.mockRejectedValue(new Error("401"));
    await render(<SidebarRecents />);
    await settle();

    expect(container.textContent).toContain("No chats yet");
    expect(container.textContent).not.toContain("Loading…");
  });

  /**
   * Pressing New chat does not itself create a session — the server mints one
   * on the first send — so this refetch usually returns the same list. It is
   * asserted anyway because it is the cheap half of staying current, and
   * dropping it would leave the list waiting up to a full poll interval for
   * anything that changed while the sidebar sat idle.
   */
  it("re-fetches when a new chat is announced", async () => {
    await render(<SidebarRecents />);
    await settle();
    expect(apiMocks.getSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT));
    });
    await settle();

    expect(apiMocks.getSessions).toHaveBeenCalledTimes(2);
  });

  /** The listener is on `window`, which outlives the component — a leaked one
   *  keeps firing fetches for every unmounted sidebar the session ever had. */
  it("stops listening once unmounted", async () => {
    await render(<SidebarRecents />);
    await settle();
    await act(async () => root.render(<></>));

    await act(async () => {
      window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT));
    });
    await settle();

    expect(apiMocks.getSessions).toHaveBeenCalledTimes(1);
  });

  /**
   * The event is not enough on its own. A conversation only becomes a session
   * on the server when its first message is sent, which is after the New chat
   * announcement and after any refetch it triggered — so without the poll the
   * chat the user is sitting in never reaches Recents until a page reload.
   */
  it("polls while mounted, so a session minted later still shows up", async () => {
    vi.useFakeTimers();
    try {
      await render(<SidebarRecents />);
      await settle();
      expect(apiMocks.getSessions).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("No chats yet");

      // The session the user just started by sending their first message.
      apiMocks.getSessions.mockResolvedValue(page([session("a", "Deploy notes")]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      await settle();

      expect(apiMocks.getSessions).toHaveBeenCalledTimes(2);
      expect(rowLabels()).toEqual(["Deploy notes"]);
    } finally {
      vi.useRealTimers();
    }
  });

  /** An interval outlives its component just as happily as a listener does. */
  it("stops polling once unmounted", async () => {
    vi.useFakeTimers();
    try {
      await render(<SidebarRecents />);
      await settle();
      await act(async () => root.render(<></>));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await settle();

      expect(apiMocks.getSessions).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Now that more than one thing can trigger a load, two can be in flight at
   * once — a poll overtaken by the announcement refetch, say. If the older
   * request resolves last, an unguarded component writes its stale list over
   * the fresh one and the sidebar silently goes backwards. Nothing throws; the
   * only symptom is a Recents list showing an older world than the page.
   */
  it("drops a stale response that resolves after a newer one", async () => {
    const answer: Array<(p: SessionPage) => void> = [];
    apiMocks.getSessions.mockImplementation(
      () => new Promise<SessionPage>((resolve) => void answer.push(resolve)),
    );

    await render(<SidebarRecents />); // request 1, from mount
    await act(async () => {
      window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT)); // request 2
    });
    expect(answer).toHaveLength(2);

    // The newer request answers first, and its list is shown.
    await act(async () => void answer[1]!(page([session("new", "Fresh chat")])));
    await settle();
    expect(rowLabels()).toEqual(["Fresh chat"]);

    // The older one lands afterwards and must be ignored, not applied.
    await act(async () => void answer[0]!(page([session("old", "Stale chat")])));
    await settle();
    expect(rowLabels()).toEqual(["Fresh chat"]);
  });

  /** The same ordering guard has to hold for the failure path: a stale
   *  rejection must not blank a list a newer request already filled. */
  it("drops a stale rejection that resolves after a newer response", async () => {
    const settlers: Array<{ resolve: (p: SessionPage) => void; reject: () => void }> = [];
    apiMocks.getSessions.mockImplementation(
      () =>
        new Promise<SessionPage>((resolve, reject) => {
          settlers.push({ resolve, reject: () => reject(new Error("401")) });
        }),
    );

    await render(<SidebarRecents />); // request 1
    await act(async () => {
      window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT)); // request 2
    });

    await act(async () => void settlers[1]!.resolve(page([session("new", "Fresh chat")])));
    await settle();
    await act(async () => void settlers[0]!.reject());
    await settle();

    expect(rowLabels()).toEqual(["Fresh chat"]);
    expect(container.textContent).not.toContain("No chats yet");
  });
});
