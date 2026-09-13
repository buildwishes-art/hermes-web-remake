import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getToolRenderer,
  getToolRenderers,
  onToolRendererRegistered,
  registerToolRenderer,
  unregisterToolRenderers,
} from "./toolRenderers";

// The registry stores components, never renders them, so a plain function
// stands in for one throughout.
const Comp = (() => null) as never;
const Other = (() => null) as never;

// The registry is module state shared across tests; only these two plugin
// names are ever used here, so clearing both empties it.
beforeEach(() => {
  unregisterToolRenderers("a");
  unregisterToolRenderers("b");
});

describe("registerToolRenderer", () => {
  it("claims a tool by name and leaves others unclaimed", () => {
    registerToolRenderer("a", "team_discuss", Comp);
    expect(getToolRenderer("team_discuss")).toBe(Comp);
    expect(getToolRenderer("read_file")).toBeUndefined();
  });

  it("lets the last registration win for the same tool", () => {
    registerToolRenderer("a", "team_discuss", Comp);
    registerToolRenderer("b", "team_discuss", Other);
    expect(getToolRenderer("team_discuss")).toBe(Other);
    expect(getToolRenderers()).toEqual(["team_discuss"]);
  });

  it("ignores a registration missing a plugin, tool, or component", () => {
    registerToolRenderer("", "x", Comp);
    registerToolRenderer("a", "", Comp);
    registerToolRenderer("a", "y", undefined as never);
    expect(getToolRenderers()).toEqual([]);
  });

  it("notifies subscribers so a late-loading bundle still shows", () => {
    const seen = vi.fn();
    const off = onToolRendererRegistered(seen);
    registerToolRenderer("a", "team_race", Comp);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    registerToolRenderer("a", "team_plan", Comp);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("survives a subscriber that throws", () => {
    const good = vi.fn();
    onToolRendererRegistered(() => {
      throw new Error("boom");
    });
    const off = onToolRendererRegistered(good);
    registerToolRenderer("a", "team_build", Comp);
    expect(good).toHaveBeenCalled();
    off();
  });
});

describe("unregisterToolRenderers", () => {
  it("drops every tool the plugin claimed and nothing else", () => {
    registerToolRenderer("a", "team_race", Comp);
    registerToolRenderer("a", "team_discuss", Comp);
    registerToolRenderer("b", "kanban_move", Other);
    unregisterToolRenderers("a");
    expect(getToolRenderers()).toEqual(["kanban_move"]);
  });

  it("is a no-op for a plugin that registered nothing", () => {
    registerToolRenderer("a", "team_race", Comp);
    unregisterToolRenderers("nope");
    expect(getToolRenderers()).toEqual(["team_race"]);
  });
});
