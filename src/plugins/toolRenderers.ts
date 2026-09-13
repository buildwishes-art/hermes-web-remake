/**
 * Per-tool result renderers.
 *
 * A plugin that ships a tool can also say how that tool's result should look.
 * Without this, every plugin tool renders as the generic one-line chip, which
 * is right for `read_file` and wrong for anything whose result has structure
 * worth seeing — a panel of models, a diff, a chart.
 *
 * A renderer claims a tool BY NAME and is used only for that tool's turns.
 * Anything unclaimed, and anything whose renderer throws, falls back to the
 * built-in chip: a plugin must not be able to make a turn unreadable.
 */

import type { ComponentType } from "react";

export interface ToolRenderProps {
  /** The tool that ran, e.g. `"team_discuss"`. */
  name: string;
  /** The invocation line the built-in chip would show. */
  text: string;
  /** What the tool returned. Absent while it is still running. */
  output?: string;
  /** True between `tool.start` and `tool.complete`. */
  running?: boolean;
}

interface RendererEntry {
  plugin: string;
  component: ComponentType<ToolRenderProps>;
}

/** Map<toolName, entry>. One renderer per tool — last registration wins. */
const _renderers = new Map<string, RendererEntry>();
const _listeners = new Set<() => void>();

function _notify() {
  for (const fn of _listeners) {
    try {
      fn();
    } catch {
      /* a dead subscriber must not stop the others */
    }
  }
}

export function registerToolRenderer(
  plugin: string,
  tool: string,
  component: ComponentType<ToolRenderProps>,
): void {
  if (!plugin || !tool || typeof component !== "function") return;
  _renderers.set(tool, { plugin, component });
  _notify();
}

export function unregisterToolRenderers(plugin: string): void {
  let changed = false;
  for (const [tool, entry] of _renderers.entries()) {
    if (entry.plugin === plugin) {
      _renderers.delete(tool);
      changed = true;
    }
  }
  if (changed) _notify();
}

export function getToolRenderer(tool: string): ComponentType<ToolRenderProps> | undefined {
  return _renderers.get(tool)?.component;
}

/** Tool names with a renderer, for diagnostics. */
export function getToolRenderers(): string[] {
  return [..._renderers.keys()];
}

/** Subscribe to registry changes — a plugin bundle can land after mount. */
export function onToolRendererRegistered(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}
