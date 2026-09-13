import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from "react-router";
import {
  Activity,
  BarChart3,
  Clock,
  Code,
  Cpu,
  Database,
  Eye,
  FolderOpen,
  FileText,
  Globe,
  Heart,
  KeyRound,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Puzzle,
  Radio,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Users,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { SelectionSwitcher } from "@nous-research/ui/ui/components/selection-switcher";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Typography } from "@nous-research/ui/ui/components/typography/index";
import { cn } from "@/lib/utils";
import { SidebarUserMenu } from "@/components/SidebarUserMenu";
import { SidebarStatusStrip } from "@/components/SidebarStatusStrip";
import { useSidebarStatus } from "@/hooks/useSidebarStatus";
import { AuthWidget } from "@/components/AuthWidget";
import { PageHeaderProvider } from "@/contexts/PageHeaderProvider";
import { ProfileProvider } from "@/contexts/ProfileProvider";
import { useProfileScope } from "@/contexts/useProfileScope";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { SidebarNewChat, SidebarRecents } from "@/components/SidebarRecents";
import { ProfileScopeBanner } from "@/components/ProfileScopeBanner";
import { MemoryPressureBanner } from "@/components/MemoryPressureBanner";
// Route pages are lazy-loaded so the initial dashboard shell does not pay for
// every admin surface (and heavy deps like xterm) up front.
const ConfigPage = lazy(() => import("@/pages/ConfigPage"));
const EnvPage = lazy(() => import("@/pages/EnvPage"));
const FilesPage = lazy(() => import("@/pages/FilesPage"));
const SessionsPage = lazy(() => import("@/pages/SessionsPage"));
const LogsPage = lazy(() => import("@/pages/LogsPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const ModelsPage = lazy(() => import("@/pages/ModelsPage"));
const CronPage = lazy(() => import("@/pages/CronPage"));
const ProfilesPage = lazy(() => import("@/pages/ProfilesPage"));
const ProfileBuilderPage = lazy(() => import("@/pages/ProfileBuilderPage"));
const SkillsPage = lazy(() => import("@/pages/SkillsPage"));
const PluginsPage = lazy(() => import("@/pages/PluginsPage"));
const McpPage = lazy(() => import("@/pages/McpPage"));
const PairingPage = lazy(() => import("@/pages/PairingPage"));
const ChannelsPage = lazy(() => import("@/pages/ChannelsPage"));
const WebhooksPage = lazy(() => import("@/pages/WebhooksPage"));
const SystemPage = lazy(() => import("@/pages/SystemPage"));
const ChatWebPage = lazy(() => import("@/pages/ChatWebPage"));
import { useI18n } from "@/i18n";
import type { Translations } from "@/i18n/types";
import { PluginPage, PluginSlot, usePlugins } from "@/plugins";
import type { PluginManifest } from "@/plugins";
import { api } from "@/lib/api";

function RouteFallback({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex min-h-[12rem] flex-1 items-center justify-center"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        <span>{label}</span>
      </div>
    </div>
  );
}

function RootRedirect() {
  return <Navigate to="/sessions" replace />;
}

function UnknownRouteFallback({ pluginsLoading }: { pluginsLoading: boolean }) {
  if (pluginsLoading) {
    // Render nothing during the plugin-load window — a spinner here would just flash.
    return null;
  }
  return <Navigate to="/sessions" replace />;
}

/**
 * Built-in routes except /chat.  Chat is rendered persistently (outside
 * <Routes>) when embedded — see the persistent chat host block rendered
 * inline near the bottom of this file — so the PTY child, WebSocket,
 * and xterm instance survive when the user visits another tab and comes
 * back.  A `display:none` toggle hides the terminal without unmounting.
 * The host itself is still deferred until the first /chat visit so the
 * xterm chunk is not downloaded on unrelated pages.  Routing still owns
 * the URL so /chat deep-links, browser back/forward, and nav highlight
 * keep working.
 */
const BUILTIN_ROUTES_CORE: Record<string, ComponentType> = {
  "/": RootRedirect,
  "/chat-web": ChatWebPage,
  "/sessions": SessionsPage,
  "/files": FilesPage,
  "/analytics": AnalyticsPage,
  "/models": ModelsPage,
  "/logs": LogsPage,
  "/cron": CronPage,
  "/skills": SkillsPage,
  "/plugins": PluginsPage,
  "/mcp": McpPage,
  "/pairing": PairingPage,
  "/channels": ChannelsPage,
  "/webhooks": WebhooksPage,
  "/system": SystemPage,
  "/profiles": ProfilesPage,
  "/profiles/new": ProfileBuilderPage,
  "/config": ConfigPage,
  "/env": EnvPage,
};

/**
 * /chat is gone — the xterm terminal surface and its own right-hand sidebar
 * were removed so the dashboard has exactly one sidebar. The path stays
 * registered as a redirect rather than falling through to the catch-all,
 * because old bookmarks and `?resume=` / `?learn=` hand-offs still point here
 * and must keep working; the query string is carried over untouched.
 */
function ChatRouteRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/chat-web${search}`} replace />;
}

// No "Work" group. Sessions and Chat are reached from the launcher above the
// nav ("New chat", the Recents list, "View all"), so the pills were a second,
// worse route to the same two places.
//
// No "Models" pill either. It was kept for one reason — the composer's model
// picker sets only the main model for the current chat, while Auxiliary Tasks
// and Mixture of Agents live on the Models page with no way to reach them from
// the composer. That way now exists: the picker's footer links straight there
// (see `onOpenModelSettings` in ModelPickerDialog), so the pill became the
// second route again. `/models` itself is untouched and still routed.
const BUILTIN_NAV_REST: NavItem[] = [
  {
    path: "/analytics",
    labelKey: "analytics",
    label: "Analytics",
    icon: BarChart3,
    group: "models",
  },
  { path: "/skills", labelKey: "skills", label: "Skills", icon: Package, group: "automation" },
  { path: "/plugins", labelKey: "plugins", label: "Plugins", icon: Puzzle, group: "automation" },
  { path: "/cron", labelKey: "cron", label: "Cron", icon: Clock, group: "automation" },
  { path: "/mcp", label: "MCP", icon: Plug, group: "automation" },
  { path: "/channels", label: "Channels", icon: Radio, group: "connections" },
  { path: "/webhooks", label: "Webhooks", icon: Webhook, group: "connections" },
  { path: "/pairing", label: "Pairing", icon: ShieldCheck, group: "connections" },
  // Profiles / Config / Keys / Logs / System / Documentation are reachable
  // from the account menu instead. Their ROUTES stay registered in
  // BUILTIN_ROUTES_CORE — only the duplicate nav entries are gone.
];

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  Activity,
  BarChart3,
  Clock,
  Cpu,
  FileText,
  FolderOpen,
  KeyRound,
  MessageSquare,
  Package,
  Settings,
  Puzzle,
  Sparkles,
  Terminal,
  Globe,
  Database,
  Shield,
  Users,
  Wrench,
  Zap,
  Heart,
  Star,
  Code,
  Eye,
};

function resolveIcon(name: string): ComponentType<{ className?: string }> {
  return ICON_MAP[name] ?? Puzzle;
}

function buildNavItems(
  builtIn: NavItem[],
  manifests: PluginManifest[],
): NavItem[] {
  const items = [...builtIn];

  for (const manifest of manifests) {
    if (manifest.tab.override) continue;
    if (manifest.tab.hidden) continue;

    const pluginItem: NavItem = {
      path: manifest.tab.path,
      label: manifest.label,
      icon: resolveIcon(manifest.icon),
    };

    const pos = manifest.tab.position ?? "end";
    if (pos === "end") {
      items.push(pluginItem);
    } else if (pos.startsWith("after:")) {
      const target = "/" + pos.slice(6);
      const idx = items.findIndex((i) => i.path === target);
      items.splice(idx >= 0 ? idx + 1 : items.length, 0, pluginItem);
    } else if (pos.startsWith("before:")) {
      const target = "/" + pos.slice(7);
      const idx = items.findIndex((i) => i.path === target);
      items.splice(idx >= 0 ? idx : items.length, 0, pluginItem);
    } else {
      items.push(pluginItem);
    }
  }

  return items;
}

/** Split merged nav into built-in sidebar entries vs plugin tabs, preserving plugin order hints. */
/**
 * Split the core destinations into the sections declared by `NAV_GROUPS`,
 * preserving each item's order within its section. Sections with nothing in
 * them are dropped, so hiding /analytics does not leave an empty heading.
 *
 * Anything without a `group` — plugins, or a destination added later that
 * nobody tagged — is returned separately rather than silently vanishing.
 */
function groupCoreNav(
  items: NavItem[],
): Array<{ id: NavGroupId | "untagged"; label: string; items: NavItem[] }> {
  const byGroup = new Map<string, NavItem[]>();
  for (const item of items) {
    const key = item.group ?? "untagged";
    const list = byGroup.get(key);
    if (list) list.push(item);
    else byGroup.set(key, [item]);
  }

  const sections = NAV_GROUPS.map((g) => ({
    id: g.id as NavGroupId | "untagged",
    label: g.label,
    items: byGroup.get(g.id) ?? [],
  })).filter((sec) => sec.items.length > 0);

  const untagged = byGroup.get("untagged");
  if (untagged?.length) {
    sections.push({ id: "untagged", label: "More", items: untagged });
  }
  return sections;
}

function partitionSidebarNav(
  builtIn: NavItem[],
  manifests: PluginManifest[],
): { coreItems: NavItem[]; pluginItems: NavItem[] } {
  const merged = buildNavItems(builtIn, manifests);
  const builtinPaths = new Set(builtIn.map((i) => i.path));
  const coreItems: NavItem[] = [];
  const pluginItems: NavItem[] = [];
  for (const item of merged) {
    if (builtinPaths.has(item.path)) coreItems.push(item);
    else pluginItems.push(item);
  }
  return { coreItems, pluginItems };
}

function buildRoutes(
  builtinRoutes: Record<string, ComponentType>,
  manifests: PluginManifest[],
): Array<{
  key: string;
  path: string;
  element: ReactNode;
}> {
  const byOverride = new Map<string, PluginManifest>();
  const addons: PluginManifest[] = [];

  for (const m of manifests) {
    if (m.tab.override) {
      byOverride.set(m.tab.override, m);
    } else {
      addons.push(m);
    }
  }

const routes: Array<{
    key: string;
    path: string;
    element: ReactNode;
  }> = [];

  for (const [path, Component] of Object.entries(builtinRoutes)) {
    const om = byOverride.get(path);
    if (om) {
      routes.push({
        key: `override:${om.name}`,
        path,
        element: <PluginPage name={om.name} />,
      });
    } else {
      routes.push({ key: `builtin:${path}`, path, element: <Component /> });
    }
  }

  for (const m of addons) {
    if (m.tab.hidden) continue;
    if (m.tab.path === "/plugins") continue;
    if (builtinRoutes[m.tab.path]) continue;
    routes.push({
      key: `plugin:${m.name}`,
      path: m.tab.path,
      element: <PluginPage name={m.name} />,
    });
  }

  for (const m of manifests) {
    if (!m.tab.hidden) continue;
    if (m.tab.path === "/plugins") continue;
    if (builtinRoutes[m.tab.path] || m.tab.override) continue;
    routes.push({
      key: `plugin:hidden:${m.name}`,
      path: m.tab.path,
      element: <PluginPage name={m.name} />,
    });
  }

  return routes;
}

/**
 * The sidebar overlays the content at every width now, so "open" means it is
 * covering part of the page — which is why the stored default is closed. The
 * old `hermes-sidebar-collapsed` key meant the opposite thing (a rail that
 * took layout space), so it is deliberately not reused: reading a stored
 * `false` under the new meaning would open a panel over the page on load.
 */
const SIDEBAR_OPEN_KEY = "hermes-sidebar-open";

export default function App() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { manifests, loading: pluginsLoading } = usePlugins();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_OPEN_KEY) === "true";
    } catch {
      return false;
    }
  });
  const setSidebar = useCallback((next: boolean) => {
    setSidebarOpen(next);
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(next));
    } catch { /* localStorage may be unavailable in private browsing */ }
  }, []);
  /**
   * Nothing here closes the panel on navigation. Picking a destination is
   * usually the first of several — you glance at Logs, then System, then back
   * to Sessions — and a sidebar that dismisses itself each time turns that
   * into three round trips to the toggle. It closes when you close it: the
   * X, the backdrop, or Escape.
   */
  const closeSidebar = useCallback(() => setSidebar(false), [setSidebar]);
  const openSidebar = useCallback(() => setSidebar(true), [setSidebar]);
  const sidebarStatus = useSidebarStatus();

  // `dashboard.show_token_analytics` gates the Analytics nav item.  The
  // page itself remains reachable by URL (it renders an explanation when
  // the flag is off — see AnalyticsPage), but hiding the nav entry avoids
  // surfacing misleading token/cost numbers in the sidebar.  Default off.
  const [showTokenAnalytics, setShowTokenAnalytics] = useState(false);
  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        const dash = (cfg?.dashboard ?? {}) as {
          show_token_analytics?: unknown;
        };
        setShowTokenAnalytics(dash.show_token_analytics === true);
      })
      .catch(() => setShowTokenAnalytics(false));
  }, []);

  const builtinRoutes = useMemo(
    () => ({ ...BUILTIN_ROUTES_CORE, "/chat": ChatRouteRedirect }),
    [],
  );

  // No longer depends on `embeddedChat`: the terminal chat lost its own nav
  // pill, so the built-in list is the same either way.
  const builtinNav = useMemo(
    () =>
      showTokenAnalytics
        ? BUILTIN_NAV_REST
        : BUILTIN_NAV_REST.filter((n) => n.path !== "/analytics"),
    [showTokenAnalytics],
  );

  const sidebarNav = useMemo(
    () => partitionSidebarNav(builtinNav, manifests),
    [builtinNav, manifests],
  );
  const routes = useMemo(
    () => buildRoutes(builtinRoutes, manifests),
    [builtinRoutes, manifests],
  );
  const pluginTabMeta = useMemo(
    () =>
      manifests
        .filter((m) => !m.tab.hidden)
        .map((m) => ({
          path: m.tab.override ?? m.tab.path,
          label: m.label,
        })),
    [manifests],
  );

  // Satu-satunya varian yang pernah dipakai. Dulu datang dari tema;
  // temanya sudah tidak ada, nilainya tidak pernah berubah.
  const layoutVariant = "standard";

  /** Chat and Chat-web own their full height; chrome above them costs the
   *  transcript real estate it cannot get back. */
  const isChatSurface = pathname === "/chat-web" || pathname === "/chat-web/";


  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSidebar();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [sidebarOpen, closeSidebar]);


  return (
    <ProfileProvider>
    <div
      data-layout-variant={layoutVariant}
      className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background-base text-text-primary antialiased"
    >
      <SelectionSwitcher />

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
      >
        <PluginSlot name="backdrop" />
      </div>


      {/* One control, both widths. The sidebar is absent for two different
          reasons — collapsed on a wide screen, off-canvas on a narrow one —
          but to the user it is the same absence, so it gets the same button in
          the same corner with the same icon. It used to be a hamburger inside
          a brand bar below `lg` and a panel icon inside the sidebar above it:
          two chromes for one idea. */}
      {!sidebarOpen && (
        <Button
          ghost
          size="icon"
          onClick={openSidebar}
          aria-label={t.app.openNavigation}
          aria-expanded={false}
          aria-controls="app-sidebar"
          className={cn(
            "fixed top-2 left-2 z-50 flex",
            "rounded-md bg-[var(--bg-secondary)]/90 backdrop-blur",
            "text-text-secondary hover:text-midground",
          )}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      )}

      {sidebarOpen && (
        <Button
          ghost
          aria-label={t.app.closeNavigation}
          onClick={closeSidebar}
          className={cn(
            "fixed inset-0 z-40 p-0 block",
            "bg-black/70",
          )}
        />
      )}

      {/* Single mobile header clearance for the banner stack + content. The
          fixed lg:hidden header is h-14/z-40; previously each banner carried
          its own mt-14 AND the content kept pt-14, so two visible banners
          stacked three offsets (NS-656 review P3). One spacer, applied once.

          Dropped on the chat surfaces: there the header floats instead of
          occupying a row, so reserving 56px for it would hand back exactly
          the space that change was meant to reclaim. */}
      <PluginSlot name="header-banner" />
      <ProfileScopeBanner />
      <MemoryPressureBanner status={sidebarStatus} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1">
          <aside
            id="app-sidebar"
            aria-label={t.app.navigation}
            className={cn(
              "fixed top-0 left-0 z-50 flex h-dvh max-h-dvh w-64 min-h-0 flex-col font-sans",
              "border-r border-current/20",
              "bg-background-base",
              // One behaviour at every width: the panel slides in over the
              // page instead of taking a column out of it. Opening it used to
              // reflow the whole layout on wide screens — every table and
              // transcript re-wrapped just to reveal a nav — while narrow
              // screens already overlaid. Same motion, same 200ms, no reflow.
              "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              sidebarOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <div
              className={cn(
                "flex h-14 shrink-0 items-center gap-2",
                "border-b border-current/20",
                "px-4 justify-between",
              )}
            >
              <div
                className="flex items-center gap-2"
              >
                <PluginSlot name="header-left" />

                {/* One line, sentence case, serif. The two-line uppercase
                    wordmark with letter-spacing was shouting from the corner
                    of every screen — a brand mark, not a thing to read. */}
                <Typography className="font-display text-[1.0625rem] leading-none text-midground">
                  Hermes Agent
                </Typography>
              </div>

              {/* One close control. There used to be two — an X below `lg`
                  and a panel icon above it — because the two widths closed the
                  sidebar in different ways. They no longer do. */}
              <Button
                ghost
                size="icon"
                onClick={closeSidebar}
                aria-label={t.app.closeNavigation}
                className="text-text-secondary hover:text-midground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>

            <ProfileSwitcher collapsed={false} />

            {/* The chat launcher sits above the destination nav, the way the
                reference puts the thing you do most above the places you go. */}
            <div className="shrink-0 border-t border-current/10">
              <SidebarNewChat onNavigate={closeSidebar} />
              <SidebarRecents onNavigate={closeSidebar} />
            </div>

            <nav
              className={cn(
                "min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden border-t border-current/10 py-2",
              )}
              aria-label={t.app.navigation}
            >
              {groupCoreNav(sidebarNav.coreItems).map((section, index) => (
                <div
                  key={section.id}
                  role="group"
                  aria-label={section.label}
                  className={cn(
                    "flex flex-col",
                    // The first section needs no separator; the rest get a
                    // hairline rather than whitespace.
                    index > 0 && "mt-1 border-t border-border-light pt-1",
                  )}
                >
                  <span
                    className="px-5 pt-2 pb-1 font-sans text-xs text-text-secondary"
                  >
                    {section.label}
                  </span>
                  <ul className="flex flex-col">
                    {section.items.map((item) => (
                      <SidebarNavLink
                        item={item}
                        key={item.path}
                        t={t}
                      />
                    ))}
                  </ul>
                </div>
              ))}

              {sidebarNav.pluginItems.length > 0 && (
                <div
                  aria-labelledby="hermes-sidebar-plugin-nav-heading"
                  className="flex flex-col border-t border-current/10 pb-2"
                  role="group"
                >
                  <span
                    className={cn(
                      "px-5 pt-2.5 pb-1",
                      "font-sans text-display text-xs tracking-[0.12em] text-text-tertiary",
                    )}
                    id="hermes-sidebar-plugin-nav-heading"
                  >
                    {t.app.pluginNavSection}
                  </span>

                  <ul className="flex flex-col">
                    {sidebarNav.pluginItems.map((item) => (
                      <SidebarNavLink
                        item={item}
                        key={item.path}
                        t={t}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </nav>

            {/* Gateway + session summary, directly above the account row.
                It used to head a separate "System" block; that block is gone —
                Restart moved onto the account row, and Update is switched off
                for this fork — so the two lines that were actually worth a
                glance now sit next to the row they describe. */}
            <div
              className={cn(
                "shrink-0 border-t border-[var(--border-light)] pt-1",
              )}
            >
              {/* Renders nothing in loopback mode, so it costs no height on
                  the setup almost everyone runs. */}
              <AuthWidget />
              <SidebarStatusStrip status={sidebarStatus} />
            </div>

            {/* Account + app menu, now the last thing in the sidebar. The
                version / org footer that used to sit under it is gone: this is
                a fork, so the upstream byline was wrong, and the version line
                already appears on the System page where it can be acted on. */}
            <div className="shrink-0 border-t border-[var(--border-light)]">
              <SidebarUserMenu
                collapsed={false}
                status={sidebarStatus}
              />
            </div>
          </aside>

          <PageHeaderProvider
            pluginTabs={pluginTabMeta}
            sidebarCollapsed={!sidebarOpen}
          >
            <div
              className={cn(
                "relative z-2 flex min-w-0 min-h-0 flex-1 flex-col",
                "px-3 sm:px-6",
                isChatSurface
                  ? "pb-0 pt-1 sm:pt-2 lg:pt-4"
                  : "pt-2 sm:pt-4 lg:pt-6",
              )}
            >
              <PluginSlot name="pre-main" />
              <div
                className={cn(
                  "w-full min-w-0",
                  // Without the flex chain the wrapper is a plain block that
                  // grows past `main`'s fixed height — and `main` clips. The
                  // composer ends up below the fold with no way to scroll to
                  // it: measured 637px tall inside a 601px viewport whose
                  // document could not scroll at all.
                  !isChatSurface &&
                    "pb-[calc(2rem+env(safe-area-inset-bottom,0px))] lg:pb-8",
                  isChatSurface &&
                    "min-h-0 flex flex-1 flex-col",
                )}
              >
                <ProfileKeyedRoutes>
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      {routes.map(({ key, path, element }) => (
                        <Route key={key} path={path} element={element} />
                      ))}
                      <Route
                        path="*"
                        element={
                          <UnknownRouteFallback pluginsLoading={pluginsLoading} />
                        }
                      />
                    </Routes>
                  </Suspense>
                </ProfileKeyedRoutes>

              </div>
              <PluginSlot name="post-main" />
            </div>
          </PageHeaderProvider>
        </div>
      </div>

      <PluginSlot name="overlay" />
    </div>
    </ProfileProvider>
  );
}

/**
 * Remounts the entire routed page tree when the global management profile
 * changes. Pages load their data on mount; without this, a page opened
 * under profile A would keep showing A's state while writes (via the
 * fetchJSON ?profile= injection) silently targeted the newly selected
 * profile B — the exact stale-target footgun the switcher exists to kill.
 * Keying by profile resets every page's local state so it refetches under
 * the new scope. (The persistent xterm host that used to live here was
 * removed along with the /chat surface.) It handles its own
 * remount (channel keyed on scopedProfile).
 */
function ProfileKeyedRoutes({ children }: { children: ReactNode }) {
  const { profile } = useProfileScope();
  return <div key={profile || "__own__"} className="contents">{children}</div>;
}

function SidebarNavLink({ item, t }: SidebarNavLinkProps) {
  const { path, label, labelKey, icon: Icon } = item;

  const navLabel = labelKey
    ? ((t.app.nav as Record<string, string>)[labelKey] ?? label)
    : label;

  return (
    <li className="px-2">
      <NavLink
        to={path}
        end={path === "/sessions"}
        className={({ isActive }) =>
          cn(
            "group/nav relative flex w-full items-center gap-3",
            // An inset rounded tile, not a full-bleed row. This is the
            // single biggest shape difference from the reference sidebar:
            // selection reads as a filled pill you can point at, rather
            // than a hairline in the margin.
            "rounded-lg px-3 py-2",
            // Sentence case, normal tracking. UPPERCASE with 0.12em
            // tracking on eighteen items is what made the list read as a
            // wall rather than a menu.
            "font-sans text-sm",
            "whitespace-nowrap transition-colors cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            isActive
              ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              : "text-text-secondary hover:bg-[var(--bg-hover)] hover:text-midground",
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                // Violet marks the current destination. It is never used
                // decoratively, so idle rows carry no colour at all.
                isActive && "text-[var(--accent)]",
              )}
            />
            {/* Always visible. The hover tooltip that used to name this item
                existed only for the collapsed icon rail, which is gone — the
                sidebar is either fully open or fully off-canvas. */}
            <span className="truncate">{navLabel}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

interface SidebarNavLinkProps {
  item: NavItem;
  t: Translations;
}

interface NavItem {
  icon: ComponentType<{ className?: string }>;
  label: string;
  labelKey?: string;
  path: string;
  /** Which sidebar section this destination belongs to. Items with no
   *  group (plugins, anything added later) fall into "more". */
  group?: NavGroupId;
}

/**
 * Eighteen flat destinations was the single most-cited navigation problem.
 * Grouping is what fixes it — an icon-only rail would have made it worse,
 * because unlabelled icons are exactly what "I can't find the page" means.
 *
 * Order is by how often an errand starts there, not alphabetically.
 */
type NavGroupId = "models" | "automation" | "connections";

const NAV_GROUPS: Array<{ id: NavGroupId; label: string }> = [
  { id: "models", label: "Models" },
  { id: "automation", label: "Automation" },
  { id: "connections", label: "Connections" },
  // No "system" group: Profiles, Config, Keys, Logs, System and Documentation
  // all live in the account menu at the foot of the sidebar now. Listing them
  // twice made the nav longer without making anything easier to find.
];


