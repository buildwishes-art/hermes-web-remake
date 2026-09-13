# hermes-web-remake

The Hermes Agent web dashboard, standalone — configuration, API keys, sessions,
and the chat surface, without the Python backend in the tree.

Lifted from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
(MIT, © 2025 Nous Research), then reworked. The section below says exactly how
it differs; [FORK.md](FORK.md) covers the packaging details of making it
standalone.

---

## How this differs from upstream

Baseline: upstream commit **`ee742fe1`**. Against it, `web/` here is
**70 files changed — 28 deleted, 42 modified — plus 29 new files**
(+1,225 / −9,627 lines before the new files are counted).

### New — the chat surface this repo exists for

Upstream's chat tab is an xterm terminal wired to a PTY. It was replaced with a
message UI that talks to the gateway's JSON-RPC socket directly.

| | |
|---|---|
| `ChatTranscript.tsx` (+ test) | the transcript itself: streaming deltas, tool lifecycle, approval and clarify prompts, resume |
| `ChatWebPage.tsx` | the page; owns URL reading so the transcript stays router-free |
| `ChatPrompt.tsx` | blocking approval / clarify cards |
| `ToolTurn.tsx` | a tool call as one quiet openable line instead of a bordered wall of monospace |
| `MessageActions.tsx`, `UserMessageActions.tsx` | copy / TTS / 👍 / 👎 / retry, revealed on hover |
| `ComposerModelButton.tsx` | current model + reasoning effort, in the composer rather than a settings page two clicks away |
| `ComposerModeButton.tsx` | Build / Plan, applied as a prefix on the outgoing message |
| `ComposerAddMenu.tsx` | attachments and the slash hand-off |
| `SidebarRecents.tsx`, `SidebarUserMenu.tsx`, `SessionRowMenu.tsx` (+ tests) | the rebuilt sidebar |
| `CommandPanel.tsx`, `CommandPanelTrigger.tsx`, `lib/command-panel.ts` (+ tests) | session palette on ⌘K / Ctrl+K |
| `lib/appearance.ts` (+ test) | light / dark / system, replacing the deleted preset engine |
| `styles/tokens.css` (+ test) | the design tokens everything above is built on |
| `DESIGN.md`, `PRODUCT.md` | what the design system actually is, written against what was built |

### Deleted

- **The xterm chat page** — `pages/ChatPage.tsx` (1,988 lines) and its test,
  plus `components/ChatSidebar.tsx` (+ test), `ChatSessionList.tsx`,
  `SidebarFooter.tsx`
- **The theme preset engine** — all of `src/themes/` (`context`, `fonts`,
  `presets`, `types`, `index`), and with it `ThemeSwitcher.tsx`
- `LanguageSwitcher.tsx`, `ReasoningPicker.tsx` — folded into the sidebar menu
  and the composer's model button
- `pages/DocsPage.tsx`
- Support modules that only the deleted page used: `chat-activation`,
  `events-reconnect`, `keyboard-inset`, `pty-mobile-input`, `pty-scroll`,
  `reasoning-effort` (each with its test), and
  `chat-sidebar-session-params.test`

### Modified

`App.tsx` (~1,100 lines changed — the shell and nav rebuild) and `index.css`
(+415, composer and token wiring) carry most of it. Then
`PageHeaderProvider.tsx`, `ModelPickerDialog.tsx`, `SessionsPage.tsx`,
`SkillsPage.tsx`, `ModelsPage.tsx`, `lib/api.ts`, `main.tsx`, and smaller
touches across the remaining pages.

All 17 locales under `src/i18n/` are intact — they were trimmed of the keys
belonging to deleted UI, not dropped.

### Not built in: the `team_ai` panel — install it instead

The multi-model panel surface — a composer control that puts several models on
one message, racing or in conversation — is not in this tree. It lives as a
Hermes plugin: **[buildwishes-art/hermes-team-ai](https://github.com/buildwishes-art/hermes-team-ai)**.
Install it and the composer gains a Team control, the dialog, and per-speaker
bubbles for the panel's results.

Five files were removed from this repo and their wiring in
`ComposerModelButton.tsx` and `ChatTranscript.tsx` unpicked; see
[FORK.md](FORK.md) for exactly what, and what was deliberately kept.

### New: the chat surface is pluggable (SDK 1.3.0)

Making that plugin possible meant giving the chat surface extension points it
did not have. A plugin can now:

| | |
|---|---|
| `chat:composer` slot | one compact control in the composer's own row, beside the model and Build/Plan buttons |
| `chat:top` / `chat:bottom` | above the transcript and below the composer. These were *documented* slots that this build rendered nowhere — they went with the deleted xterm page and nothing re-hung them |
| `registerSendTransform` | rewrite the outgoing message. Narrow on purpose: message in, message out, no session and no way to cancel a send. One that throws or empties the message is skipped |
| `registerToolRenderer` | render one tool's results instead of the generic one-line chip. Unclaimed tools fall back |

Also fixed while in there: `sdk.d.ts` declared `registerSlot(slot, name, …)`
while `slots.ts` implements `registerSlot(plugin, slot, …)`. Nothing in-repo
used slots, so nothing caught it — an external author following the published
types would have registered into a slot named after their plugin and never
rendered.

### Known leftovers

`lib/pty-composition`, `pty-reconnect`, `pty-keyboard-shortcuts`,
`pty-resume-loading` and `pty-resume-sanitizer` are **dead code**. Nothing
outside that cluster imports any of them — they were orphaned when the xterm
page went, and their tests still pass, which is why nothing flagged them. The
one surviving xterm consumer is `HermesConsoleModal.tsx`, which uses
`styles/terminal.ts`.

---

## Stack

- **Vite** + **React 19** + **TypeScript**
- **Tailwind CSS v4** with custom dark theme
- **shadcn/ui**-style components (hand-rolled, no CLI dependency)

## Development

This is the frontend only. It needs a Hermes Agent backend to talk to:

```bash
# elsewhere, in a Hermes Agent checkout
python -m hermes_cli.main serve --port 9119
```

Then here:

```bash
npm install
npm run dev
```

Open the **Vite URL** printed in the terminal (usually `http://localhost:5173`).

`/api` requests — REST and the `/api/ws` JSON-RPC socket — proxy to
`http://127.0.0.1:9119`. Set `HERMES_DASHBOARD_URL` to point somewhere else.
Without a backend the app loads and then sits disconnected; that is the socket,
not a build problem.

## Checks

```bash
npm run check      # typecheck + test + lint
```

## Build

```bash
npm run build
```

Outputs to `dist/`. Upstream builds to `../hermes_cli/web_dist/`, which the
FastAPI server serves as a static SPA — repoint `build.outDir` in
`vite.config.ts` if you are wiring this back into a Hermes checkout.

## Structure

```
src/
├── components/ui/   # Reusable UI primitives (Card, Badge, Button, Input, etc.)
├── lib/
│   ├── api.ts       # API client — typed fetch wrappers for all backend endpoints
│   └── utils.ts     # cn() helper for Tailwind class merging
├── pages/
│   ├── StatusPage   # Agent status, active/recent sessions
│   ├── ConfigPage   # Dynamic config editor (reads schema from backend)
│   └── EnvPage      # API key management with save/clear
├── App.tsx          # Main layout and navigation
├── main.tsx         # React entry point
└── index.css        # Tailwind imports and theme variables
```

## Typography & contrast rules

Read before adding or editing UI styles. These rules keep the dashboard legible across all built-in themes and stop drift back into the patterns the design system was just refactored out of.

### Text size floor

- **Minimum body size: `text-xs` (12px / 0.75rem).** Do not use arbitrary `text-[0.6rem]`, `text-[0.65rem]`, `text-[9px]`, `text-[10px]`, or `text-[11px]` on copy, hints, labels, counts, or badges. Use the standard scale: `text-xs`, `text-sm`, `text-base`.
- Smaller sizes are only acceptable on **decorative overlays** (chart stripes, empty-state icons) — never on text the user is meant to read.

### Opacity floor on text

- **Never apply opacity below 0.7 to text.** No `opacity-30`, `opacity-50`, `opacity-60` on `<span>`s, `<p>`s, labels, etc.
- **Do not stack opacity tokens.** Patterns like `text-muted-foreground/60`, `text-midground/70`, `text-foreground/50` create unpredictable WCAG failures because the parent token already has alpha.
- Use the **semantic text tokens** from `@nous-research/ui`'s `globals.css`:
  - `text-text-primary` — default body text.
  - `text-text-secondary` — subtitles, meta, inactive nav.
  - `text-text-tertiary` — small chrome labels, counts, footnotes.
  - `text-text-disabled` — disabled states.
  - `text-text-on-accent` — text on filled accent surfaces.

### Brand uppercase via `text-display`, not raw `uppercase`

- The dashboard preserves the Nous brand uppercase aesthetic, but it is **opt-in per element, not global**.
- Apply uppercase via the DS utility `text-display` on **brand chrome only** — page titles, nav section headings, badges, brand wordmark. DS components (`Button`, `Badge`, `Tabs`, `Segmented`, etc.) already self-apply `text-display`.
- **Do not introduce new `uppercase`** (the literal Tailwind class) in `src/`. Prefer `text-display` for new brand chrome. Legacy `uppercase` call sites (e.g. `components/ui/label.tsx`, `card.tsx`) remain until migrated.
- The app shell no longer forces uppercase globally, so blanket `normal-case` opt-outs are unnecessary. Use `normal-case` only where a DS component applies `text-display` but the label should stay sentence case — e.g. dynamic user content (model slugs, theme names) **or** fixed UI copy that is not brand chrome (EnvPage “not configured” toggle, sidebar “New chat”).

### Fonts

Typography is **opt-in per surface**, not global on layout shells — the app shell and page header keep their original theme/expanded fonts; Mondwest applies only where explicitly set.

| Tier | Classes | Use for |
|------|---------|---------|
| Brand chrome | `font-mondwest text-display` (or `themedChrome`) | Sidebar nav, card section headers (`CardTitle`), Segmented filter buttons, filter panel headings |
| Themed body | `font-mondwest normal-case` (or `themedBody`) | Card content (`Card`, `CardDescription`), session/platform rows, analytics tables — **scoped to the component** |
| Page chrome | `font-expanded` | Page header h1 (`PageHeaderProvider`) — sentence case, not `text-display` |
| Wordmark | `Typography` + size/tracking only | Sidebar/mobile “Hermes Agent” — mixed case, no Mondwest, no `text-display` |
| Technical | `font-mono-ui` / `font-mono` / `font-courier` | Model slugs, env keys, schedules, YAML, repo URLs |

- Do **not** put `themedBody` or `themedFont` on `<main>`, `App`, or other layout wrappers — it overrides component-scoped styles.
- **`Card`** applies `themedBody`; **`CardTitle`** uses `text-display` (uppercase chrome); **`CardDescription`** uses `themedBody`.
- **`NouiTypography`** defaults to `font-sans` unless a font prop is passed.
- Do **not** use raw `font-sans` or `font-display` (theme sans variable) on new dashboard UI — prefer Mondwest tiers above where brand-appropriate.

### Color tokens

- Prefer **semantic tokens** (`text-text-*`, `bg-card`, `border-border`, `text-foreground`, `text-destructive`, `text-success`, `text-warning`) over raw layer references (`text-midground`, `text-foreground`).
- `text-muted-foreground` is now wired to `--color-text-secondary`, so existing call sites stay correct, but new code should prefer the semantic name.
- When you genuinely need a non-token color (icon de-emphasis on a chart, terminal foreground via inline style), keep alpha at `≥ 0.7` for any text.

