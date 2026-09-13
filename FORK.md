# What this repo is, and how it differs from upstream

This is the `web/` dashboard of [Hermes Agent](https://github.com/NousResearch/hermes-agent)
(MIT, © 2025 Nous Research), lifted out into a standalone repository so the UI
can be reworked without carrying the Python backend. The upstream `LICENSE` is
included unchanged, as MIT requires.

Everything below is a change made to this copy. Nothing else in `src/` was
touched — if it is not on this list, it is upstream code.

## Layout

Upstream, this app lives at `web/` inside the Hermes Agent monorepo and depends
on a workspace sibling at `apps/shared`. A standalone checkout has no workspace
root, so:

- the app is the repository root (`src/`, `package.json`, … at top level)
- `apps/shared` is **vendored** into this repo — it is the same `@hermes/shared`
  package, five modules under `src/` import from it, and without it nothing
  builds
- the three places that named the old relative path were repointed:
  `package.json` (`file:./apps/shared`), `vite.config.ts` (alias),
  `tsconfig.app.json` (`paths` + `include`)
- `vitest.config.ts` gained the same `@hermes/shared` alias. Upstream it had
  none, because the tests resolved through the symlink npm creates for a
  `file:` dependency; aliasing it explicitly makes the tests read the copy in
  this repo rather than whatever npm happened to link
- `apps/shared/eslint.config.mjs` was deleted — it only re-exported the
  monorepo root's `eslint.config.shared.mjs`, which is not here and needs two
  plugins this app does not depend on. The repo-root `eslint.config.js`
  already matches `**/*.{ts,tsx}`, so the package is still linted. Its now-dead
  `lint` / `fix` / `check` scripts were dropped with it

## Build output

Upstream builds to `../hermes_cli/web_dist/`, which the Python server serves.
That path is outside this repository, so `vite.config.ts` now builds to `dist/`.
Point it back at `hermes_cli/web_dist` if you wire this into a Hermes checkout.

## Dependencies

`eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks` and
`globals` are hoisted from the monorepo root upstream. They are declared in
`package.json` here, at the versions the workspace pins, so `npm run lint`
works on a fresh clone.

The upstream root `package.json` also carries a block of `overrides` pinning
transitive dependencies for security. Those are **not** copied here — they were
written against the full monorepo tree, and several pin packages this app does
not pull in. Re-add the ones you care about if you ship this.

## Removed: the `team_ai` panel surface

The multi-model panel UI is deliberately absent. Deleted:

- `src/lib/teamPanel.ts`, `src/lib/teamPanel.test.ts`
- `src/components/TeamPanelDialog.tsx`
- `src/components/PanelBubbles.tsx`, `src/components/PanelBubbles.test.tsx`

and the wiring for it in `ComposerModelButton.tsx` (the *Team AI* row and its
dialog) and `ChatTranscript.tsx` (the arming state, the composer chip, the
send-path transform, and the bubble branch in `TurnView`).

The composer's **Build / Plan** button is unconditional again, as it was before
that surface existed.

### What was kept, and why

`ChatTranscript.tsx` still reads `result` off the `tool.complete` event into
`Turn.output` and passes it to `ToolTurn`. That is **not** part of `team_ai`:
the gateway has always sent the field and the transcript has always dropped it,
so the Output half of an expanded tool row was permanently empty for *every*
tool. Reverting it would re-break something unrelated to the panel.

## State of the checks

Verified against this tree before the first push:

| check | result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` | 329 passed, 35 files |
| `vite build` | built to `dist/` |
| `eslint .` | 0 errors, 27 warnings |

The warnings are upstream's, not new: the same tree before the removal reports
28, the extra one being the `react-refresh` warning on the deleted
`PanelBubbles.tsx`.

## Backend

This repository is frontend only. It talks to a Hermes Agent backend over
JSON-RPC on `/api/ws` and REST on `/api/*`; `npm run dev` proxies both to
`http://127.0.0.1:9119`, overridable with `HERMES_DASHBOARD_URL`. Without a
backend running, the app loads and then sits disconnected.
