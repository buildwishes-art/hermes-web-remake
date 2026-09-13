/**
 * SidebarUserMenu — the account-and-app menu that lives at the foot of the
 * sidebar.
 *
 * Modelled on the reference app's user popover. The borrowed idea is not the
 * list of rows, it is the **right-aligned value**: each row states its current
 * setting (which workspace, gateway up or down, which language) so the common
 * case — "just checking" — is answered without opening the page at all.
 *
 * Rows route to pages that already exist. This menu deliberately owns no
 * settings of its own; duplicating a control in two places is how two places
 * end up disagreeing.
 *
 * Primary navigation is NOT repeated here. The reference's menu holds
 * account-level concerns, and so does this one — Sessions, Models and Skills
 * stay in the nav above where they belong.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  FileText,
  Check,
  ChevronLeft,
  Languages,
  Monitor,
  Moon,
  Sun,
  FolderOpen,
  KeyRound,
  RotateCw,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, LOCALE_META } from "@/i18n";
import type { Locale } from "@/i18n";
import { useAppearance } from "@/lib/appearance";
import { useProfileScope } from "@/contexts/useProfileScope";
import { gatewayLine } from "@/components/SidebarStatusStrip";
import { GatewayRestartConfirm } from "@/components/GatewayRestartConfirm";
import { useSystemActions } from "@/contexts/useSystemActions";
import type { StatusResponse } from "@/lib/api";

interface SidebarUserMenuProps {
  collapsed: boolean;
  onNavigate?: () => void;
  status: StatusResponse | null;
}

interface MenuRow {
  icon: typeof Settings;
  label: string;
  /** Right-aligned current value. Omit for rows that have no state. */
  value?: string;
  /** Tailwind text colour for the value — used only where the value carries
   *  meaning (gateway up/down). Everything else stays muted. */
  valueTone?: string;
  /** Navigation target. Omit for rows that act in place instead. */
  to?: string;
  /** In-place behaviour, for rows that change something rather than go
   *  somewhere (appearance, language). */
  action?: () => void;
  /** Keep the menu open after `action` — appearance cycles, so you need to
   *  see the result and press again without reopening. */
  keepOpen?: boolean;
}

/** Mirrors `--duration-fast` in tokens.css; the panel unmounts once its exit
 *  animation has had time to finish. */
const EXIT_MS = 150;

export function SidebarUserMenu({
  collapsed,
  onNavigate,
  status,
}: SidebarUserMenuProps) {
  const { t } = useI18n();
  const { profile, currentProfile } = useProfileScope();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const { isBusy, pendingAction, runAction } = useSystemActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const workspace = profile || currentProfile || "default";
  const initial = (workspace[0] ?? "H").toUpperCase();

  // `auth_required` is the dashboard's OAuth gate. Only the subtitle changes
  // with it — signing out stays with `AuthWidget`, which already POSTs to
  // /auth/logout and handles the redirect. A second logout control here would
  // be a second chance to get a security-relevant flow wrong.
  const gated = Boolean(status?.auth_required);

  const gateway = status ? gatewayLine(status, t) : null;

  /**
   * `closing` keeps the panel mounted for the length of its exit animation.
   * Unmounting on the state change would skip the close entirely — React
   * removes the node before a single frame of it can play.
   *
   * The timer is driven from the handlers rather than an effect, so there is
   * no render that writes state, and it is cleared on unmount below so a menu
   * closed on the way out of the page cannot set state on a dead component.
   */
  const [closing, setClosing] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const close = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) return false;
      setClosing(true);
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => setClosing(false), EXIT_MS);
      return false;
    });
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  const { locale, setLocale } = useI18n();
  const { mode, cycle } = useAppearance();
  /** The menu shows either its rows or the locale list, never both — a
   *  nested popover inside a popover fights the outside-click handler. */
  const [showLocales, setShowLocales] = useState(false);

  const APPEARANCE_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
  const APPEARANCE_LABEL = { system: "System", light: "Light", dark: "Dark" } as const;

  const rows: MenuRow[] = [
    {
      icon: Users,
      label: t.app.nav.profiles ?? "Profiles",
      value: workspace,
      to: "/profiles",
    },
    {
      icon: Settings,
      label: t.app.nav.config ?? "Config",
      to: "/config",
    },
    {
      icon: KeyRound,
      label: t.app.nav.keys ?? "Keys",
      to: "/env",
    },
    {
      // The Work group lost its Files pill, but the managed-file browser and
      // its nine /api/files endpoints are very much alive — without a row here
      // the page would only be reachable by typing the URL.
      icon: FolderOpen,
      label: t.app.nav.files ?? "Files",
      to: "/files",
    },
    {
      icon: FileText,
      label: t.app.nav.logs ?? "Logs",
      to: "/logs",
    },
    {
      icon: Wrench,
      label: "System",
      value: gateway?.label,
      valueTone: gateway?.tone,
      to: "/system",
    },
    {
      // Cycles System -> Light -> Dark in place. The menu stays open so you
      // can step through and watch the page change.
      icon: APPEARANCE_ICON[mode],
      label: t.app.nav.appearance ?? "Appearance",
      value: APPEARANCE_LABEL[mode],
      action: cycle,
      keepOpen: true,
    },
    {
      // Opens the locale list in place. This actually switches the language;
      // the row it replaces merely linked to /config, which was already a row
      // of its own two lines up.
      icon: Languages,
      label: t.language.switchTo,
      value: LOCALE_META[locale]?.name ?? locale.toUpperCase(),
      action: () => setShowLocales(true),
      keepOpen: true,
    },
  ];

  const go = (to: string) => {
    setOpen(false);
    setShowLocales(false);
    onNavigate?.();
    navigate(to);
  };

  return (
    <div ref={containerRef} className="relative shrink-0 px-2 py-2">
      {/* Two controls side by side, not one. The restart icon sits where the
          chevron used to, and a <button> cannot legally contain another
          <button> — nesting them produces invalid markup and a control the
          keyboard cannot reach separately. */}
      <div
        className={cn(
          "flex items-center gap-1 rounded-lg transition-colors",
          open && "bg-[var(--bg-hover)]",
        )}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          aria-label={collapsed ? workspace : undefined}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            if (exitTimer.current) clearTimeout(exitTimer.current);
            setClosing(false);
            setOpen(true);
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2",
            "text-left transition-colors cursor-pointer",
            "hover:bg-[var(--bg-hover)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <Avatar initial={initial} />

          <span
            className={cn(
              "flex min-w-0 flex-1 flex-col transition-[opacity,width] duration-300",
              collapsed
                ? "lg:w-0 lg:overflow-hidden lg:opacity-0"
                : "lg:w-auto lg:opacity-100",
            )}
          >
            <span className="truncate text-sm text-[var(--text-primary)]">
              {workspace}
            </span>
            <span className="truncate text-xs text-[var(--text-secondary)]">
              {gated ? t.app.footer.org : "Local workspace"}
            </span>
          </span>
        </button>

        {/* Restart never fires on the click itself — it opens the same
            confirmation the labelled action in the sidebar uses. Hidden in the
            52px rail, where two controls cannot sit side by side; the labelled
            entry in the system block stays reachable there. */}
        <button
          type="button"
          onClick={() => setRestartOpen(true)}
          disabled={isBusy}
          title={t.status.restartGateway}
          aria-label={t.status.restartGateway}
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-md",
            "text-[var(--text-secondary)] transition-colors cursor-pointer",
            "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            "disabled:cursor-not-allowed disabled:opacity-40",
            collapsed && "lg:hidden",
          )}
        >
          <RotateCw
            className={cn(
              "h-4 w-4",
              pendingAction === "restart" && "animate-spin",
            )}
            aria-hidden
          />
        </button>
      </div>

      {(open || closing) && (
        <div
          id={menuId}
          role="menu"
          aria-label={workspace}
          // Hidden from assistive tech the moment it is logically closed —
          // the exit animation is decoration, not content.
          aria-hidden={closing || undefined}
          className={cn(
            open ? "hermes-menu-in" : "hermes-menu-out",
            "absolute bottom-full left-2 right-2 mb-2",
            "rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]",
            "py-1 shadow-[var(--shadow-md)]",
            // Collapsed rail is 52px — the panel would be unreadable inside
            // it, so it escapes to the right of the rail instead.
            collapsed && "lg:left-full lg:right-auto lg:bottom-2 lg:ml-2 lg:w-60",
          )}
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar initial={initial} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-[var(--text-primary)]">
                {workspace}
              </span>
              <span className="truncate text-xs text-[var(--text-secondary)]">
                Local workspace
              </span>
            </span>
          </div>

          <div className="my-1 border-t border-[var(--border-light)]" />

          {showLocales ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setShowLocales(false)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-sm",
                  "text-left text-[var(--text-secondary)] transition-colors cursor-pointer",
                  "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                )}
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{t.language.switchTo}</span>
              </button>

              {/* Twenty locales do not fit a popover — scroll rather than
                  push the menu past the top of the viewport. */}
              <div className="max-h-64 overflow-y-auto">
                {(Object.keys(LOCALE_META) as Locale[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={code === locale}
                    onClick={() => {
                      setLocale(code);
                      setShowLocales(false);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-sm",
                      "text-left transition-colors cursor-pointer",
                      "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      code === locale
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]",
                    )}
                  >
                    <span className="w-4 shrink-0">
                      {code === locale && (
                        <Check className="h-4 w-4" aria-hidden />
                      )}
                    </span>
                    <span className="flex-1 truncate">{LOCALE_META[code].name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            rows.map((row) => (
              <MenuItem
                key={row.label}
                row={row}
                onSelect={() => {
                  if (row.action) {
                    row.action();
                    if (!row.keepOpen) setOpen(false);
                    return;
                  }
                  if (row.to) go(row.to);
                }}
              />
            ))
          )}

        </div>
      )}

      {/* Outside the `open &&` block on purpose. A pointerdown inside the
          dialog counts as outside this menu and closes it; if the dialog were
          mounted within the menu it would be torn down mid-confirmation. */}
      <GatewayRestartConfirm
        loading={pendingAction === "restart"}
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => {
          setRestartOpen(false);
          setOpen(false);
          void runAction("restart");
        }}
        open={restartOpen}
      />
    </div>
  );
}

function Avatar({ initial }: { initial: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full",
        "bg-[var(--accent)] text-sm font-medium text-[var(--bg-primary)]",
      )}
    >
      {initial}
    </span>
  );
}

function MenuItem({ row, onSelect }: { row: MenuRow; onSelect: () => void }) {
  const Icon = row.icon;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-sm",
        "text-left text-[var(--text-secondary)] transition-colors cursor-pointer",
        "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{row.label}</span>
      {row.value && (
        <span
          className={cn(
            "ml-2 shrink-0 truncate text-xs",
            // Muted by default; only the gateway's value earns a colour,
            // and it is paired with the row label so colour is never the
            // only thing carrying the state.
            row.valueTone ?? "text-[var(--text-secondary)]",
          )}
        >
          {row.value}
        </span>
      )}
    </button>
  );
}
