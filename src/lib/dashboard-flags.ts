declare global {
  interface Window {
    /**
     * Injected by the server as `true`. The embedded chat surface
     * (`/chat-web` over `/api/ws`) is always enabled, so this is effectively
     * a constant; kept on `window` for any consumer that reads it directly
     * and for parity with the server's bootstrap script.
     */
    __HERMES_DASHBOARD_EMBEDDED_CHAT__?: boolean;
  }
}

/**
 * Whether the dashboard's embedded TUI Chat surface is available.
 *
 * The embedded chat (`/chat-web`, over the `/api/ws` gateway socket) is an
 * unconditional part of the dashboard, so this always returns `true`. It is
 * retained as a stable seam so call sites — currently the Sessions page's
 * "Resume in Chat" action — don't need to change if the surface ever becomes
 * conditional again.
 *
 * The xterm terminal surface this used to describe (`/chat`, `/api/pty`) was
 * removed from the dashboard; `/chat` now redirects to `/chat-web`.
 */
export function isDashboardEmbeddedChatEnabled(): boolean {
  return true;
}
