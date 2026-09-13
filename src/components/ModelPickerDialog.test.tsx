// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelPickerDialog } from "./ModelPickerDialog";

/**
 * Only the pre-seed is covered here — the path the model finder added.
 *
 * The rule it has to keep: seeding jumps the two-stage walk but must NOT jump
 * the confirmation. Applying still goes through the dialog's own Switch
 * button, so the persist choice and the expensive-model warning stay in front
 * of the user.
 */

// React needs to be told this is a test renderer before anything mounts.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const OPTIONS = {
  model: "gpt-4o",
  provider: "openai",
  providers: [
    { name: "OpenAI", slug: "openai", models: ["gpt-4o", "gpt-4o-mini"], is_current: true },
    { name: "Anthropic", slug: "anthropic", models: ["claude-opus-5", "claude-sonnet-5"] },
  ],
};

async function open(extra: Record<string, unknown> = {}) {
  const onApply = vi.fn().mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ModelPickerDialog
        loader={async () => OPTIONS}
        onApply={onApply}
        onClose={vi.fn()}
        alwaysGlobal
        {...extra}
      />,
    );
  });
  return { onApply };
}

const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("pre-seeding", () => {
  it("leaves Switch disabled when nothing is seeded", async () => {
    await open();
    expect(button("Switch")!.disabled).toBe(true);
  });

  it("arms Switch for the seeded provider and model", async () => {
    await open({ initialProvider: "anthropic", initialModel: "claude-opus-5" });
    expect(button("Switch")!.disabled).toBe(false);
    // The seeded provider's models are the ones on screen, not the current
    // provider's — otherwise the seed picked a model you cannot see.
    expect(document.body.textContent).toContain("claude-opus-5");
  });

  it("still requires the Switch press before anything is applied", async () => {
    const { onApply } = await open({
      initialProvider: "anthropic",
      initialModel: "claude-opus-5",
    });
    expect(onApply).not.toHaveBeenCalled();

    await act(async () => button("Switch")!.click());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
    });
  });

  it("ignores a seed for a provider the gateway did not return", async () => {
    await open({ initialProvider: "not-a-provider", initialModel: "ghost" });
    // Falls back to the current provider rather than rendering an empty stage.
    expect(document.body.textContent).toContain("gpt-4o");
  });
});
