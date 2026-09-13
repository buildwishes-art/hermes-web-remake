import type { Translations } from "@/i18n/types";

const BUILTIN: Record<string, keyof Translations["app"]["nav"]> = {
  "/chat": "chat",
  "/chat-web": "chat",
  "/sessions": "sessions",
  "/analytics": "analytics",
  "/models": "models",
  "/logs": "logs",
  "/cron": "cron",
  "/skills": "skills",
  "/plugins": "plugins",
  "/profiles": "profiles",
  "/config": "config",
  "/env": "keys",
};

// Built-in routes without an i18n nav key. Keep these in sync with the
// sidebar labels in App.tsx — the naive capitalize fallback below mangles
// initialisms ("/mcp" → "Mcp") and can't match multi-word labels.
const BUILTIN_LITERAL: Record<string, string> = {
  "/files": "Files",
  "/mcp": "MCP",
  "/channels": "Channels",
  "/webhooks": "Webhooks",
  "/pairing": "Pairing",
  "/system": "System",
  "/profiles/new": "New profile",
};

export function resolvePageTitle(
  pathname: string,
  t: Translations,
  pluginTabs: { path: string; label: string }[],
): string {
  const normalized = pathname.replace(/\/$/, "") || "/";
  if (normalized === "/") {
    return t.app.nav.sessions;
  }
  const plugin = pluginTabs.find((p) => p.path === normalized);
  if (plugin) {
    return plugin.label;
  }
  const key = BUILTIN[normalized];
  // Some nav keys are optional in Translations (locales that predate them fall
  // back to English), so an entry in BUILTIN is not a guarantee of a string.
  const translated = key ? t.app.nav[key] : undefined;
  if (translated) {
    return translated;
  }
  const literal = BUILTIN_LITERAL[normalized];
  if (literal) {
    return literal;
  }
  // Derive title from pathname: "/profiles" → "Profiles"
  const segment = normalized.slice(1);
  if (segment) {
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  }
  return t.app.webUi;
}
