import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { PageHeaderContext } from "./page-header-context";
import { resolvePageTitle } from "@/lib/resolve-page-title";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/**
 * Surfaces whose content is genuinely tabular or streaming.
 *
 * `/models` and `/sessions` were added after an audit found them squeezed:
 * the model list is `md:grid-cols-2 xl:grid-cols-3`, and `xl` is 1280px, so
 * inside an 860px column its third column could never render at any window
 * size; session transcripts carry monospace tool-call payloads in `<pre>`
 * blocks that scroll horizontally for the width they don't get.
 */
const WIDE_CONTENT_ROUTES = [
  "/logs",
  "/analytics",
  "/system",
  "/files",
  "/env",
  "/models",
  "/sessions",
];

export function PageHeaderProvider({
  children,
  pluginTabs,
  sidebarCollapsed = false,
}: {
  children: ReactNode;
  pluginTabs: { path: string; label: string }[];
  /**
   * When the sidebar is collapsed on desktop it disappears entirely, and the
   * button that brings it back floats in the top-left corner the sidebar
   * vacated — directly over where this header's title starts. Indenting just
   * this one row clears it, which costs a header indent rather than the full
   * -height gutter a reserved rail would.
   */
  sidebarCollapsed?: boolean;
}) {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [afterTitle, setAfterTitle] = useState<ReactNode>(null);
  const [end, setEnd] = useState<ReactNode>(null);

  // Clear any per-page title / toolbar slots when the path changes. Child routes
  // re-fill these on mount via usePageHeader.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    setTitleOverride(null);
    setAfterTitle(null);
    setEnd(null);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const defaultTitle = useMemo(
    () => resolvePageTitle(pathname, t, pluginTabs),
    [pathname, t, pluginTabs],
  );
  const displayTitle = titleOverride ?? defaultTitle;

  // Both chat surfaces own their own scroll and full height: the terminal
  // would be letterboxed by the centred column, and the message UI already
  // centres its own transcript and pins its composer to the bottom.
  const isChatRoute =
    pathname === "/chat" ||
    pathname === "/chat/" ||
    pathname === "/chat-web" ||
    pathname === "/chat-web/";

  /**
   * The centred content column — the thing that makes twenty pages feel like
   * one system instead of twenty. Applied here, once, rather than in each
   * page: a page that sets its own width is the bug this prevents.
   *
   * `DESIGN.md` allows exactly two widths. Data-heavy surfaces opt into the
   * wide one because a log table squeezed into 860px is unreadable; nothing
   * else may, and the list is spelled out so "just add mine" is a visible
   * decision rather than a quiet drift back to full-bleed.
   */
  const isWideRoute = WIDE_CONTENT_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );
  /** Env jump-nav is wide — stack below title on small screens so KEYS stays readable. */
  const isEnvRoute =
    pathname === "/env" || pathname.startsWith("/env/");

  const value = useMemo(
    () => ({
      setAfterTitle,
      setEnd,
      setTitle: setTitleOverride,
    }),
    [],
  );

  return (
    <PageHeaderContext.Provider value={value}>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className={cn(
            "z-1 w-full shrink-0",
            // The chat surfaces already say which page you are on — the nav
            // entry is highlighted and the composer is unmistakable. A title
            // bar there is a row of chrome repeating what the screen already
            // shows, and vertical space is the scarcest thing in a transcript.
            isChatRoute && "hidden",
            "box-border border-b border-current/20",
            "bg-background-base",
            // Mobile stacks title + toolbar — fixed h-14 clips content; desktop stays one row.
            "min-h-0 overflow-x-hidden overflow-y-visible py-3 sm:h-14 sm:min-h-[3.5rem] sm:overflow-hidden sm:py-0",
          )}
          role="banner"
        >
          <div
            className={cn(
              "flex w-full min-w-0 flex-1 gap-3 px-3 sm:h-full sm:gap-3 sm:px-6",
              // Not `lg:` any more: below the breakpoint the sidebar is
              // off-canvas, so the same floating toggle sits in the same
              // corner and needs the same clearance.
              //
              // The `sm:` copy is load-bearing. This row also carries
              // `sm:px-6`, and at >=640px that responsive utility is emitted
              // after an unprefixed `pl-12` and wins — which left the toggle
              // sitting on top of the title on wide screens while narrow ones
              // looked correct.
              sidebarCollapsed && "pl-12 sm:pl-12",
              isChatRoute
                ? "flex-row items-center"
                : "flex-col justify-center sm:flex-row sm:items-center",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 flex-1 gap-2 sm:gap-3",
                afterTitle && isEnvRoute
                  ? "flex-col items-start sm:flex-row sm:items-center"
                  : afterTitle
                    ? "flex-row flex-wrap items-center"
                    : "flex-row items-center",
              )}
            >
              <h1
                className={cn(
                  "font-expanded min-w-0 text-sm font-bold tracking-[0.08em] text-midground",
                  afterTitle && isEnvRoute
                    ? "max-w-full sm:min-w-0 sm:shrink sm:truncate"
                    : afterTitle
                      ? "shrink truncate"
                      : "truncate",
                )}
              >
                {displayTitle}
              </h1>
              {afterTitle ? (
                <div
                  className={cn(
                    "min-w-0 scrollbar-none",
                    isEnvRoute
                      ? "w-full overflow-x-auto sm:flex-1 sm:overflow-x-auto"
                      : "shrink-0 overflow-visible",
                  )}
                >
                  {afterTitle}
                </div>
              ) : null}
            </div>

            {end ? (
              <div
                className={cn(
                  "flex min-w-0 sm:max-w-md sm:flex-1",
                  isChatRoute
                    ? "w-auto shrink-0 justify-end"
                    : "w-full justify-start sm:justify-end",
                )}
              >
                {end}
              </div>
            ) : null}
          </div>
        </header>

        <main
          className={cn(
            "min-h-0 w-full min-w-0 flex-1 flex flex-col",
            // Bottom inset for scrolled pages lives on the route outlet wrapper in
            // `App.tsx` (`w-full min-w-0`) so it pads scrollable content, not flex chrome.
            isChatRoute
              ? "overflow-hidden"
              : "overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
          )}
        >
          {isChatRoute ? (
            // Chat is a full-height terminal; centring it would letterbox
            // the PTY and waste the height it actually needs.
            children
          ) : (
            <div
              className="mx-auto w-full min-w-0 px-6 py-8"
              style={{
                maxWidth: isWideRoute
                  ? "var(--content-max-wide)"
                  : "var(--content-max)",
              }}
            >
              {children}
            </div>
          )}
        </main>
      </div>
    </PageHeaderContext.Provider>
  );
}
