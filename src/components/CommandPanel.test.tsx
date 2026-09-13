// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandPanel, type PanelItem } from "./CommandPanel";

/**
 * The shared picker. Four surfaces use it, so a regression here is a
 * regression in all of them at once — which is the argument for one component,
 * and the argument for pinning its behaviour.
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
  await act(async () => root.unmount());
  container.remove();
});

const ITEMS: PanelItem[] = [
  { id: "a", title: "Alpha session", badge: "cli", meta: "2 msgs", group: "August 2026" },
  { id: "b", title: "Beta session", badge: "desktop", meta: "1 msg", group: "August 2026" },
  { id: "c", title: "(untitled)", badge: "acp", group: "September 2026", keywords: "6f5ccfd4" },
];

const options = () => [...container.querySelectorAll('[role="option"]')];
const activeRow = () => container.querySelector('[role="option"][data-active="true"]');
const input = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;

const type = async (text: string) => {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const press = async (key: string) => {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
};

function setup(overrides: Partial<Parameters<typeof CommandPanel>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const ui = (
    <CommandPanel
      open
      onClose={onClose}
      title="Resume a session"
      items={ITEMS}
      onSelect={onSelect}
      {...overrides}
    />
  );
  return { ui, onSelect, onClose };
}

describe("closed state", () => {
  it("renders nothing at all when closed", async () => {
    const { ui } = setup();
    await render(<>{ui}</>);
    await act(async () => root.render(<CommandPanel open={false} onClose={vi.fn()} title="x" items={ITEMS} onSelect={vi.fn()} />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("search", () => {
  it("matches on the title", async () => {
    const { ui } = setup();
    await render(ui);
    await type("beta");
    expect(options()).toHaveLength(1);
    expect(options()[0]!.textContent).toContain("Beta session");
  });

  /**
   * `keywords` is the only way to find a row whose title is empty — searching
   * by session id is exactly that case, and it is not shown on the row.
   */
  it("matches on hidden keywords", async () => {
    const { ui } = setup();
    await render(ui);
    await type("6f5ccfd4");
    expect(options()).toHaveLength(1);
    expect(options()[0]!.textContent).toContain("(untitled)");
  });

  it("says so when nothing matches", async () => {
    const { ui } = setup({ emptyLabel: "No saved sessions yet" });
    await render(ui);
    await type("zzzz");
    expect(options()).toHaveLength(0);
    expect(container.textContent).toContain("No saved sessions yet");
  });
});

describe("keyboard", () => {
  it("moves the highlight and clamps at both ends", async () => {
    const { ui } = setup();
    await render(ui);
    expect(activeRow()?.textContent).toContain("Alpha");

    await press("ArrowUp"); // already at the top
    expect(activeRow()?.textContent).toContain("Alpha");

    await press("ArrowDown");
    expect(activeRow()?.textContent).toContain("Beta");

    await press("ArrowDown");
    await press("ArrowDown"); // past the end
    expect(activeRow()?.textContent).toContain("(untitled)");
  });

  it("Enter selects the highlighted row and closes", async () => {
    const { ui, onSelect, onClose } = setup();
    await render(ui);
    await press("ArrowDown");
    await press("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: "b" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes without selecting", async () => {
    const { ui, onSelect, onClose } = setup();
    await render(ui);
    await press("Escape");
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  /**
   * A narrowed list can leave the stored cursor past the end. Reads clamp, so
   * Enter must still pick a real row rather than `undefined`.
   */
  it("still selects a real row after the search narrows past the cursor", async () => {
    const { ui, onSelect } = setup();
    await render(ui);
    await press("ArrowDown");
    await press("ArrowDown"); // cursor = 2
    await type("alpha"); // one result left
    await press("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: "a" });
  });
});

describe("structure", () => {
  it("groups rows under their headings, in list order", async () => {
    const { ui } = setup();
    await render(ui);
    const headings = [...container.querySelectorAll('[role="listbox"] > div > p')].map(
      (p) => p.textContent,
    );
    expect(headings).toEqual(["August 2026", "September 2026"]);
  });

  it("wires the listbox to the input for screen readers", async () => {
    const { ui } = setup();
    await render(ui);
    const el = input();
    const listbox = container.querySelector('[role="listbox"]')!;
    // Focus stays in the field, so the active row is announced through
    // aria-activedescendant rather than by moving focus.
    expect(el.getAttribute("aria-controls")).toBe(listbox.id);
    expect(el.getAttribute("aria-activedescendant")).toBe(activeRow()!.id);
  });

  it("omits the detail pane unless a renderer is given", async () => {
    const plain = setup();
    await render(plain.ui);
    expect(container.textContent).not.toContain("Nothing selected");

    await act(async () =>
      root.render(
        <CommandPanel
          open
          onClose={vi.fn()}
          title="t"
          items={ITEMS}
          onSelect={vi.fn()}
          renderDetail={(item) => <p>detail for {item.title}</p>}
        />,
      ),
    );
    expect(container.textContent).toContain("detail for Alpha session");
  });

  it("shows the caller's confirm verb in the footer", async () => {
    const { ui } = setup({ confirmLabel: "resume" });
    await render(ui);
    expect(container.textContent).toContain("resume");
  });
});
