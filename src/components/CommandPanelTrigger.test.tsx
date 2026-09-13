// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandPanelTrigger } from "./CommandPanelTrigger";
import { commandKeyLabel, useCommandPanelKey } from "@/lib/command-panel";

/**
 * Four surfaces share this opener. The shortcut is the part worth pinning:
 * a stray binding that also fires on plain "k" would eat typing everywhere.
 */

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

afterEach(async () => {
  // The pure-function tests never render, so there is nothing to tear down.
  if (root) {
    await act(async () => root.unmount());
    container.remove();
  }
  root = undefined as unknown as Root;
  vi.unstubAllGlobals();
});

function setPlatform(platform: string, userAgent = "") {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
}

const key = async (init: KeyboardEventInit) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
};

function Harness({ onOpen, enabled }: { onOpen(): void; enabled?: boolean }) {
  useCommandPanelKey(onOpen, enabled);
  return null;
}

describe("commandKeyLabel", () => {
  it("names the real key per platform", () => {
    setPlatform("MacIntel");
    expect(commandKeyLabel()).toBe("⌘K");

    // Telling a Windows user to press Command is just a wrong instruction.
    setPlatform("Win32");
    expect(commandKeyLabel()).toBe("Ctrl K");

    // iPad reports a desktop-ish platform string; the UA is what gives it away.
    setPlatform("", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)");
    expect(commandKeyLabel()).toBe("⌘K");
  });
});

describe("useCommandPanelKey", () => {
  it("opens on Ctrl+K and on Cmd+K", async () => {
    const onOpen = vi.fn();
    await render(<Harness onOpen={onOpen} />);

    await key({ key: "k", ctrlKey: true });
    await key({ key: "K", metaKey: true }); // shift-typed capital
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("ignores an unmodified k, and Ctrl+Alt+K", async () => {
    const onOpen = vi.fn();
    await render(<Harness onOpen={onOpen} />);

    await key({ key: "k" });
    // Ctrl+Alt is AltGr on several keyboard layouts, where it types a character.
    await key({ key: "k", ctrlKey: true, altKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("binds nothing while disabled", async () => {
    const onOpen = vi.fn();
    await render(<Harness onOpen={onOpen} enabled={false} />);
    await key({ key: "k", ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", async () => {
    const onOpen = vi.fn();
    await render(<Harness onOpen={onOpen} />);
    await act(async () => root.render(<></>));
    await key({ key: "k", ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("swallows the browser's own Ctrl+K so the address bar does not take it", async () => {
    await render(<Harness onOpen={vi.fn()} />);
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("CommandPanelTrigger", () => {
  it("shows the label and the shortcut, and opens on click", async () => {
    setPlatform("Win32");
    const onClick = vi.fn();
    await render(<CommandPanelTrigger onClick={onClick}>Find a session</CommandPanelTrigger>);

    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Find a session");
    expect(button.querySelector("kbd")!.textContent).toBe("Ctrl K");

    await act(async () => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire while disabled", async () => {
    const onClick = vi.fn();
    await render(
      <CommandPanelTrigger onClick={onClick} disabled>
        Find a session
      </CommandPanelTrigger>,
    );
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });
});
