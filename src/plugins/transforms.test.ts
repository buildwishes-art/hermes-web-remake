import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applySendTransforms,
  getSendTransforms,
  registerSendTransform,
  unregisterSendTransform,
} from "./transforms";

beforeEach(() => {
  for (const name of getSendTransforms()) unregisterSendTransform(name);
});

describe("applySendTransforms", () => {
  it("returns the text untouched when nothing is registered", () => {
    expect(applySendTransforms("hello")).toBe("hello");
  });

  it("chains transforms in registration order", () => {
    registerSendTransform("a", (t) => `${t} a`);
    registerSendTransform("b", (t) => `${t} b`);
    expect(applySendTransforms("x")).toBe("x a b");
  });

  it("replaces a plugin's transform instead of stacking a second one", () => {
    // Plugin bundles re-run on reload; registering twice must not double-apply.
    registerSendTransform("a", (t) => `${t} first`);
    registerSendTransform("a", (t) => `${t} second`);
    expect(getSendTransforms()).toEqual(["a"]);
    expect(applySendTransforms("x")).toBe("x second");
  });

  it("skips a transform that throws and keeps the earlier text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerSendTransform("good", (t) => `${t}!`);
    registerSendTransform("bad", () => {
      throw new Error("boom");
    });
    expect(applySendTransforms("x")).toBe("x!");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips a transform that empties the message", () => {
    // A broken plugin must not be able to swallow what someone typed.
    registerSendTransform("eater", () => "   ");
    expect(applySendTransforms("please keep me")).toBe("please keep me");
  });

  it("skips a transform that returns a non-string", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerSendTransform("wrong", () => 42 as unknown as string);
    expect(applySendTransforms("x")).toBe("x");
    warn.mockRestore();
  });

  it("ignores a registration with no name or no function", () => {
    registerSendTransform("", (t) => `${t}?`);
    registerSendTransform("nofn", undefined as unknown as (t: string) => string);
    expect(getSendTransforms()).toEqual([]);
  });
});

describe("unregisterSendTransform", () => {
  it("removes only the named plugin", () => {
    registerSendTransform("a", (t) => `${t} a`);
    registerSendTransform("b", (t) => `${t} b`);
    unregisterSendTransform("a");
    expect(getSendTransforms()).toEqual(["b"]);
    expect(applySendTransforms("x")).toBe("x b");
  });

  it("is a no-op for an unknown plugin", () => {
    registerSendTransform("a", (t) => t);
    unregisterSendTransform("nope");
    expect(getSendTransforms()).toEqual(["a"]);
  });
});
