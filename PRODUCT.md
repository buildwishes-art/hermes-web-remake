# Product

## Register

product

## Users

A single operator running Hermes Agent on their own machine — the same person who
owns the gateway, the API keys, and the sessions it manages. They reach the
dashboard at `localhost:9119` while already in the middle of something else:
checking why a cron run failed, switching the model a session uses, reading back
a conversation from last week, confirming a skill actually installed.

They are technical and they are not browsing. Every visit is an errand. The
dashboard is never the destination — the agent is. Success is the operator
finding the one thing they came for and leaving.

## Product Purpose

A browser control surface for a local AI agent: sessions, models, skills,
plugins, cron, channels, MCP servers, logs, config, and environment. Twenty
pages that all answer one question — *what is my agent doing, and how do I
change it?*

Success looks like: the operator stops opening the terminal for things the
dashboard could have told them.

## Brand Personality

Calm, legible, unhurried. Three words: **quiet, ordered, sure.**

The interface should feel like a well-kept workshop — everything has a place,
nothing shouts, and the tool you reach for is where you left it. Confidence is
expressed by restraint, not by density. When the agent is idle, the screen
should look idle.

## Anti-references

Named by the operator, all four at once:

1. **Too busy.** Screens where many things compete for attention at once, so
   nothing reads first. The current dashboard packs stat rows, tab bars, filter
   chips and action buttons above the content the user actually came for.
2. **Foreign colors and typography.** The `@nous-research/ui` palette and its
   display faces (Collapse, Rules Compressed/Expanded, Mondwest) are not
   comfortable to sit with for long stretches.
3. **Inconsistent layout between pages.** Each of the twenty pages feels
   separately authored rather than part of one system — different headers,
   different spacing, different affordances for the same action.
4. **Confusing navigation.** Twenty destinations presented as a flat list, with
   no grouping to say which few matter today.

Also out: the generic admin-panel look (hero metric row, identical card grid,
tiny tracked uppercase eyebrows), and the terminal/hacker aesthetic. This is a
quiet tool, not a cockpit.

## Design Principles

1. **One system, twenty pages.** A page that invents its own header, its own
   spacing, or its own button shape is a bug. The shell is the design; pages
   fill a slot in it.
2. **The errand comes first.** Whatever the user came for outranks everything
   the page could also show. Stats, filters and bulk actions yield vertical
   position to content.
3. **Restraint reads as confidence.** Violet is for the current selection, the
   primary action, and live state — never for decoration. An idle screen looks
   idle.
4. **Room to breathe, even in a tool.** The operator chose the airy reference
   deliberately. Density is earned per-surface by real data volume, not applied
   by default.
5. **Familiar affordances, no invention.** Standard nav, standard controls,
   standard modals-as-last-resort. The tool should disappear into the task.

## Accessibility & Inclusion

- WCAG 2.2 AA as the floor. Body text ≥ 4.5:1 against its surface; large text
  and UI boundaries ≥ 3:1. Placeholder text is held to the body-text ratio, not
  left at a muted default.
- The palette is dark-only by design intent, so contrast is verified against
  `--bg-primary` and `--bg-secondary` specifically, not against an idealised
  black.
- Violet (`--accent`) never carries meaning alone — state is also conveyed by
  shape, position, icon, or label, so a red/green or blue/violet confusion does
  not lose information.
- Every interactive element has a visible, non-color focus ring. Keyboard reach
  covers the rail, the page nav, and the composer.
- `prefers-reduced-motion: reduce` has a real alternative on every transition,
  not a blanket disable.
