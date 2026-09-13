# Design

Visual system for the Hermes Agent web dashboard.

The dark palette was derived by measuring the operator's own reference app
(`open-claude`) in the browser — computed styles, not eyeballed from a
screenshot. The light palette was built afterwards to the same rules and
measured the same way. Every ratio in this file is computed from the hex values
in `tokens.css`, never estimated.

## Theme

Two modes, both first-class. The account menu carries a System / Light / Dark
control; `System` stamps no attribute and follows `prefers-color-scheme`, an
explicit choice stamps `data-theme` on the root element and wins over it.

**Dark** — deep violet-black rather than neutral black: every surface carries a
trace of the accent's hue, which is what keeps the palette from reading as
"generic dark dashboard".

**Light** — not the dark palette inverted. A single hue held at 303° across all
four surfaces (spread 2.9°, saturation 37–42%), so the tint reads as one
material rather than a gradient. Pure white appears nowhere: an unbroken white
canvas is the thing the operator asked to be rid of.

The earlier rule here was "there is no light mode — a half-maintained second
theme is worse than none". The rule was right; the answer to it is that the
second theme is not half-maintained, and that is enforced rather than promised.
`src/styles/tokens.test.ts` asserts that every colour the dark palette defines
has a light value — a token added to one and forgotten in the other fails the
suite — and that the `[data-theme="light"]` block and the
`prefers-color-scheme: light` block stay identical, since CSS cannot join a
media query to a selector list and nothing else would keep the two in step.

## Color

Tokens live in `src/styles/tokens.css` — a standalone file with no imports and
no framework coupling, so the Electron desktop app (`apps/desktop`) can adopt
the same surface later by importing that one file.

Both palettes define the same token names. Nothing outside `tokens.css` may
reference a raw hex or branch on the theme — a component that hardcodes a color
works in one mode and is wrong in the other.

One carve-out, and only one: **xterm.js is canvas-rendered and cannot read a CSS
custom property**, so the console pane's colors have to exist as JavaScript
strings. `styles/terminal.ts` holds its background and foreground, and
`styles/terminal.test.ts` fails the build if they drift from `--bg-primary` /
`--text-primary`. Its 16 ANSI colors are a protocol, not palette — SGR 30–37 and
90–97 have to land on recognisable red, green, yellow — so they are tuned for
the dark ground and the pane stays dark in both themes. A terminal that follows
the UI theme would need a second ANSI set legible on light; until someone wants
that, dark is the decision, not an oversight.

### Dark

| Token | Value | Role |
| --- | --- | --- |
| `--bg-primary` | `#14111E` | App canvas. The deepest surface. |
| `--bg-secondary` | `#1E1A2C` | Raised surfaces: sidebar, cards, composer, panels. |
| `--bg-tertiary` | `#29233B` | Inputs, wells, table header rows. |
| `--bg-hover` | `#322B47` | Hover on any raised surface. |
| `--text-primary` | `#ECEAF3` | Body and headings. |
| `--text-secondary` | `#ABA4BD` | Supporting copy, descriptions. |
| `--text-tertiary` | `#7F7893` | Metadata, timestamps, disabled. |
| `--accent` | `#A78BFA` | Current selection, primary action, live state. |
| `--accent-hover` | `#8B5CF6` | Accent under pointer. |
| `--border` | `#342E49` | Decorative card and panel edges. |
| `--border-strong` | `#7468A0` | **Control boundaries**: inputs, selects, checkboxes. |
| `--border-light` | `#241F33` | Internal dividers inside a surface. |
| `--shadow` | `rgb(0 0 0 / 0.3)` | Resting elevation. |
| `--shadow-md` | `rgb(0 0 0 / 0.4)` | Popovers, dropdowns, modals. |

**Strategy: Restrained.** Violet is the only chromatic color and it appears on
well under 10% of any screen. It marks the current thing and the primary action.
It is never a decorative fill, never a gradient, never applied to an inactive
state.

**Measured contrast** — computed from the hex values above, not estimated:

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `--text-primary` on `--bg-primary` | 15.62:1 | AAA |
| `--text-primary` on `--bg-secondary` | 14.23:1 | AAA |
| `--text-secondary` on `--bg-secondary` | 7.08:1 | AAA — safe for body |
| `--text-secondary` on `--bg-primary` | 7.78:1 | AAA |
| `--text-tertiary` on `--bg-secondary` | 4.04:1 | **large text / metadata only** |
| `--accent` on `--bg-secondary` | 6.23:1 | AA |
| `--success` on `--bg-secondary` | 11.12:1 | AAA |
| `--warning` on `--bg-secondary` | 11.75:1 | AAA |
| `--danger` on `--bg-secondary` | 6.30:1 | AA |

`--text-tertiary` sits at 4.04:1 — under the 4.5:1 body floor. It is permitted
for timestamps, counts, and disabled labels; it must **not** carry placeholder
text or any prose the operator has to read. Placeholders use `--text-secondary`.

### Light

| Token | Value | Role |
| --- | --- | --- |
| `--bg-primary` | `#EFDCEE` | App canvas. |
| `--bg-secondary` | `#EBD1E9` | Raised surfaces: sidebar, cards, composer, panels. |
| `--bg-tertiary` | `#E7C5E6` | Inputs, wells, table header rows. |
| `--bg-hover` | `#E3BAE1` | Hover on any raised surface. |
| `--text-primary` | `#1B1630` | Body and headings. |
| `--text-secondary` | `#453D5E` | Supporting copy, descriptions. |
| `--text-tertiary` | `#6A6187` | Metadata, timestamps, disabled. |
| `--accent` | `#5B21B6` | Current selection, primary action, live state. |
| `--accent-hover` | `#4C1D95` | Accent under pointer. |
| `--border` | `#D8B6D6` | Decorative card and panel edges. |
| `--border-strong` | `#8A6088` | **Control boundaries**. |
| `--border-light` | `#DFC3DD` | Internal dividers inside a surface. |
| `--shadow` | `0 1px 2px rgb(28 24 48 / 0.08)` | Resting elevation. |
| `--shadow-md` | `0 4px 16px rgb(28 24 48 / 0.12)` | Popovers, dropdowns, modals. |

Shadows carry less opacity than in dark. On a light ground the dark-mode values
read as smudges rather than lift.

**Measured contrast:**

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `--text-primary` on `--bg-primary` | 13.41:1 | AAA |
| `--text-primary` on `--bg-secondary` | 12.32:1 | AAA |
| `--text-secondary` on `--bg-secondary` | 7.12:1 | AAA — safe for body |
| `--text-secondary` on `--bg-primary` | 7.75:1 | AAA |
| `--text-tertiary` on `--bg-secondary` | 4.04:1 | **large text / metadata only** |
| `--accent` on `--bg-secondary` | 6.34:1 | AA |
| `--success` on `--bg-secondary` | 5.43:1 | AA |
| `--warning` on `--bg-secondary` | 5.23:1 | AA |
| `--danger` on `--bg-secondary` | 5.66:1 | AA |

`--text-tertiary` lands on 4.04:1 in both palettes — the same figure, the same
restriction. Metadata only; never placeholder text, never prose.

Status colors invert in darkness rather than in hue: `--success` `#065F46`,
`--warning` `#7C4A03`, `--danger` `#9F1239`. Same meanings, same
never-color-alone rule as the dark set below.

### The border problem, and why there are two

Two measurements the reference app does not survive unchanged:

- `--border` against `--bg-secondary` is **1.32:1**, and against `--bg-primary`
  **1.45:1**.
- The surface steps themselves are **1.10:1** (secondary over primary) and
  **1.13:1** (tertiary over secondary).

That is fine for what it does on cards: the edge is decorative, the grouping is
already carried by the background step, and nothing about identifying the
control depends on seeing that line. It is *not* fine on an input, where the
border is the only thing saying "you can type here" — WCAG 2.2 **1.4.11**
requires 3:1 for boundaries that identify a control.

Hence `--border-strong` (`#7468A0`), placed on the same hue and saturation as
`--border` and raised in lightness only until it clears the bar on every surface
it can land on: **3.41:1** on `--bg-secondary`, **3.03:1** on `--bg-tertiary`,
**3.75:1** on `--bg-primary`. Inputs, selects, checkboxes, radios and any
control whose outline is its affordance use `--border-strong`. Cards, panels and
dividers keep `--border`.

Light repeats the split for the same reason, moving in the other direction —
`--border-strong` (`#8A6088`) is *darkened* rather than lightened until it
clears: **3.93:1** on `--bg-primary`, **3.61:1** on `--bg-secondary`, **3.29:1**
on `--bg-tertiary`. Decorative `--border` sits at **1.28:1** on
`--bg-secondary`, and the surface steps at **1.09:1** and **1.10:1** — within a
hundredth of the dark palette's 1.10 and 1.13. A contrast checker run over the
whole file will flag those three numbers in both themes. They are the intended
values, not misses: the step is felt, not read, and nothing about identifying a
control depends on seeing it.

### Semantic states

Status colors are held to the same violet-leaning darkness so they sit in the
palette rather than on top of it. Each pairs with an icon or a label — color
never carries the meaning alone.

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `#6EE7B7` | Ran, connected, installed. |
| `--warning` | `#FCD34D` | Degraded, expiring, retrying. |
| `--danger` | `#FB7185` | Failed, disconnected, destructive action. |
| `--info` | `--accent` | Live, streaming, in progress. |

## Typography

Two families on a genuine contrast axis — serif against sans — not two similar
sans faces.

- **UI: `Inter, system-ui, -apple-system, sans-serif`.** Everything the operator
  interacts with or reads as data: labels, buttons, table cells, body copy, nav.
- **Display: `Georgia, "Tiempos Text", serif` at weight 300.** Reserved for the
  page-level greeting and page titles only. The product register bans display
  faces in UI labels, and that ban holds — the serif never touches a button, a
  form label, a table header, or a data cell.
- **Mono: `"JetBrains Mono", ui-monospace, monospace`.** Already bundled for the
  embedded terminal; kept for logs, env values, IDs, and code.

Fixed rem scale, not fluid clamps — the operator views at one DPI, and a
heading that shrinks inside a panel looks broken rather than responsive.

| Step | Size | Weight | Used for |
| --- | --- | --- | --- |
| `display` | 30px / 36px ≥768px | 300, serif | Greeting, page title |
| `lg` | 18px | 500 | Section headings |
| `base` | 15px | 400 | Body, nav, controls |
| `sm` | 14px | 500 | Card titles, table headers |
| `xs` | 13px | 400 | Metadata, timestamps |

Ratio between steps stays near 1.15 — many type elements on a dashboard, so
exaggerated jumps become noise. Prose caps at 70ch; tables may run wider.

## Layout

Three fixed regions, identical on all twenty pages. A page that invents its own
header is the bug this system exists to prevent.

- **Sidebar** — `16rem` wide, full height, fixed to the left edge, `border-r`.
  It **overlays** the page at every width; it never takes a column out of the
  layout. Opening it used to reflow everything on wide screens — every table and
  transcript re-wrapping just to reveal a nav — while narrow screens already
  overlaid. One behaviour now, at both widths.
  Its open/closed state persists across route changes and reloads
  (`localStorage`), because a nav that shuts itself every time you use it is a
  nav you stop using.
  Top to bottom: title row with the collapse toggle, "New chat", Recents with
  "View all", then the grouped destinations. The account row is the
  **bottom-most element** — there is no version/branding footer under it.
- **Content column** — centered, `max-width: var(--content-max)` (`860px`),
  padding `px-6 py-8`. Implemented once, in `PageHeaderProvider`, so no page
  can opt out by forgetting. Data-heavy surfaces take `--content-max-wide`
  (`1280px`) via the `WIDE_CONTENT_ROUTES` list at the top of that file —
  currently `/logs`, `/analytics`, `/system`, `/files`, `/env`. Chat is excluded
  outright: centring a full-height PTY would letterbox it.

  Grepping the pages for a `max-w-*` utility finds nothing and suggests the
  column was never built. It is applied as an inline `maxWidth` off a custom
  property instead — search `--content-max`, not `max-w`.
- **Composer** — pinned to the bottom of the column on conversational surfaces.

### What earns a nav pill

A destination reachable two ways from the same screen is a destination with one
pill too many.

- No **Work** group. Sessions and Chat are reached from the launcher above the
  nav — "New chat", the Recents list, "View all" — so the pills were a second,
  worse route to the same two places.
- No **Models** pill. It was kept for one reason: the composer's model picker
  sets only the main model for the current chat, while Auxiliary Tasks and
  Mixture of Agents live on the Models page with no way to reach them. That way
  now exists — the picker's footer links straight there — so the pill became a
  second route again. `/models` is still routed; only the pill is gone.
- A group with nothing visible in it renders no heading. Hiding `/analytics`
  removes the "Models" section entirely rather than leaving an empty label.

Spacing scale: `4 / 8 / 12 / 16 / 24 / 32 / 48`. Vertical rhythm is deliberately
uneven — 24px between peers, 48px between sections — so grouping is legible
without rules or boxes.

Flexbox for one-dimensional runs, Grid only for genuine two-axis layouts.
Responsive behaviour is structural: tables scroll inside their own container,
the column narrows. The sidebar does not change behaviour with width — it
overlays at every size — so there is nothing for a breakpoint to switch. Type
never scales fluidly.

### Radii and elevation

| Token | Value | Applied to |
| --- | --- | --- |
| `--radius-sm` | `6px` | Chips, badges, small controls |
| `--radius` | `8px` | Cards, buttons, inputs |
| `--radius-lg` | `16px` | Composer, modals, large panels |
| `--radius-full` | `9999px` | Avatars, the send button |

Elevation is carried by background step and border, not by shadow. Shadow
appears only on surfaces that genuinely float above the page — dropdowns,
popovers, modals.

## Components

Every interactive component ships all seven states: default, hover, focus,
active, disabled, loading, error. Half a set is not a component.

- **Card** — `--bg-secondary`, `1px --border`, `--radius`, `12px` padding. The
  whole card is the hit target when it navigates; it is a `<button>` or an `<a>`,
  never a `<div>` with a click handler. Cards never nest.
- **Composer** — `--bg-secondary`, `1px --border`, `--radius-lg`, `16px`
  padding, accent focus ring on `:focus-within`. Icon actions bottom-left, model
  selector and circular accent send button bottom-right.
- **Nav item** — full-width row in the sidebar, `--radius`. Active:
  `--bg-tertiary` fill plus `--accent` icon. Hover: `--bg-hover`. Focus: 2px
  `--accent` ring, offset 2px.
- **Table** — header row on `--bg-tertiary`, rows divided by `--border-light`,
  hover `--bg-hover`. Scrolls inside its own `overflow-x: auto`; the page body
  never scrolls sideways.
- **Empty state** — teaches the surface: what this page is for, and the one
  action that fills it. Never the word "empty".
- **Loading** — skeletons shaped like the content they replace. Spinners only
  inside a control the user just pressed.

## Motion

150–250ms, `ease-out` with an exponential curve. Motion reports state change and
nothing else: no page-load choreography, no decorative drift, no bounce.

- Surface transitions (hover, focus, selection): 150ms.
- Entering elements (dropdown, toast): 200ms, opacity plus 4px travel.
- Route changes: no transition. The operator is on an errand.

Two surfaces move on a named curve, `cubic-bezier(0.23, 1, 0.32, 1)` — fast
departure, long settle:

- **Sidebar** — 200ms `translateX`, full width in and out. Transform only: it
  overlays, so nothing else on the page recalculates while it moves.
- **Account menu** — 150ms, `transform-origin: bottom center`. It grows out of
  the account row it belongs to (`scaleY(0.8) translateY(4px)` → none) and
  collapses back into it. The exit runs to completion before unmount rather than
  the element vanishing on click, so the menu retracts toward its origin instead
  of blinking out.

Under `prefers-reduced-motion: reduce` both drop to `animation: none` and the
duration tokens collapse to 100ms.

Under `prefers-reduced-motion: reduce`, travel is dropped and opacity crossfades
in 100ms. Content is visible by default and never gated behind a transition —
a reveal that never fires ships a blank page.

## Z-index scale

Semantic, never arbitrary: `dropdown 10 → sticky 20 → drawer 30 →
modal-backdrop 40 → modal 50 → toast 60 → tooltip 70`.

The numbers are the ones the app stacks at, not an idealised ladder:
`sticky 20 → dropdown / drawer 50 → modal-backdrop / modal / toast 100 →
alert 200`. `--z-alert` is the tier a confirm needs to outrank the modal that
opened it; the previous scale had no room for it, which is why 12 files bypassed
it with a bare `z-[100]`.

Renumbering to a tidier 10–70 ladder was considered and rejected: page-local
decoration already sits on `z-10/20/30/40` inside the content column, so a
dropdown demoted to `10` would slide under the `z-20` element on the Models
page. The 16 call sites now read `z-[var(--z-modal)]` / `z-[var(--z-alert)]` —
same layering, no arbitrary numbers.
