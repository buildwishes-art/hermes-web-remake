/**
 * Terminal colours for the embedded xterm.js pane.
 *
 * xterm.js is canvas-rendered: it takes colours as JavaScript strings and
 * cannot read a CSS custom property, so these two values have to exist on
 * the JS side. They are the only runtime values the deleted theme system
 * actually supplied — `layoutVariant` was always `"standard"`, and every
 * other token is CSS.
 *
 * Keep in step with `--bg-primary` / `--text-primary` in `tokens.css`;
 * `styles/terminal.test.ts` fails the build if they drift.
 */

/** `--bg-primary` */
export const TERMINAL_BACKGROUND = "#14111e";

/** `--text-primary` */
export const TERMINAL_FOREGROUND = "#eceaf3";
