// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The delta-assembly contract, pinned.
 *
 * Verified against a live gateway before this component existed: asking the
 * agent to count to ten arrived as four `message.delta` frames, and the "10"
 * split across a frame boundary ("…\n1" then "0"). A transcript that replaced
 * on each delta instead of appending would render "0" and look like the model
 * had answered wrongly — a bug that only shows up on multi-frame answers, so
 * the short-reply happy path would never catch it.
 */

type Handler = (event: { type: string; payload?: unknown }) => void;

const gatewayMocks = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    close: vi.fn(),
    connect: vi.fn(async () => undefined),
    // Two parameters on purpose: the assertions below read `call[1]` (the
    // params object), and a one-arg mock types the call tuple as
    // `[method: string]` — which passes the tests and then fails `tsc` in the
    // build. Echoing `params` back also keeps it a used binding.
    // Explicit wide return type: without it TypeScript infers the union of
    // just these two literals, and a later `mockImplementation` returning a
    // different shape fails `tsc` — which the test run happily passes.
    request: vi.fn(
      async (
        method: string,
        params?: Record<string, unknown>,
      ): Promise<Record<string, unknown>> =>
        method === "session.create" ? { session_id: "s1" } : { received: params },
    ),
    on: vi.fn((type: string, fn: Handler) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(fn);
      return () => set?.delete(fn);
    }),
    onState: vi.fn((fn: (s: string) => void) => {
      fn("open");
      return () => {};
    }),
    emit(type: string, payload?: unknown) {
      for (const fn of gatewayMocks.handlers.get(type) ?? []) fn({ type, payload });
    },
  };
});

vi.mock("@/lib/gatewayClient", () => ({
  GatewayClient: class {
    close = gatewayMocks.close;
    connect = gatewayMocks.connect;
    on = gatewayMocks.on;
    onState = gatewayMocks.onState;
    request = gatewayMocks.request;
  },
}));

interface SlashCall {
  command: string;
  sessionId: string;
  callbacks: { send: (text: string) => unknown; sys: (text: string) => void };
}

// Typed argument: without it the mock's call tuple infers as `[]` and the
// assertions below cannot reach the options object.
const slashMocks = vi.hoisted(() => ({
  executeSlash: vi.fn(async (opts: { command: string }) =>
    opts.command ? ("done" as const) : ("error" as const),
  ),
}));
vi.mock("@/lib/slashExec", () => ({ executeSlash: slashMocks.executeSlash }));

// The completion popover fetches over the gateway on every keystroke; it has
// its own tests and would only add noise here.
vi.mock("@/components/SlashPopover", () => ({
  SlashPopover: () => null,
}));

const { ChatTranscript } = await import("./ChatTranscript");

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

const turns = () => [...container.querySelectorAll("ol li")].map((li) => li.textContent ?? "");

beforeEach(() => {
  gatewayMocks.handlers.clear();
  // reset, not clear: `clearAllMocks` wipes recorded calls but LEAVES any
  // `mockImplementation` a test installed, so an override like "hold the
  // socket at connecting" silently leaks into every test after it. `vi.fn(fn)`
  // restores the factory implementation on reset, which is the default we want.
  vi.resetAllMocks();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("streaming assembly", () => {
  it("appends deltas instead of replacing, including across a split token", async () => {
    await render(<ChatTranscript />);

    await act(async () => {
      gatewayMocks.emit("message.start");
      // The exact frames observed on the live gateway.
      for (const chunk of ["1\n2", "\n3\n4\n5\n6", "\n7\n8\n9\n1", "0"]) {
        gatewayMocks.emit("message.delta", { text: chunk });
      }
    });

    expect(turns()[0]).toContain("1\n2\n3\n4\n5\n6\n7\n8\n9\n10");
  });

  it("opens a turn when a delta arrives without message.start", async () => {
    await render(<ChatTranscript />);
    // A reconnect can drop the opening frame; the token must still land.
    await act(async () => gatewayMocks.emit("message.delta", { text: "orphan" }));
    expect(turns()[0]).toContain("orphan");
  });

  it("lets message.complete win over the assembled deltas", async () => {
    await render(<ChatTranscript />);
    await act(async () => {
      gatewayMocks.emit("message.start");
      gatewayMocks.emit("message.delta", { text: "partial" });
      // `complete` is authoritative — deltas can be lossy across a reconnect.
      gatewayMocks.emit("message.complete", { text: "final answer", usage: { model: "m", total: 5 } });
    });
    const [first] = turns();
    expect(first).toContain("final answer");
    expect(first).not.toContain("partial");
  });

  it("renders a provider failure as a system line, not as an empty answer", async () => {
    await render(<ChatTranscript />);
    // Observed shape when the upstream was unreachable: no start, no deltas,
    // just a complete carrying the error text.
    await act(async () =>
      gatewayMocks.emit("message.complete", { text: "API call failed after 3 retries" }),
    );
    expect(turns()[0]).toContain("API call failed after 3 retries");
  });
});

describe("transient events stay out of the transcript", () => {
  it("routes reasoning and retry progress to the status line", async () => {
    await render(<ChatTranscript />);
    await act(async () => {
      gatewayMocks.emit("thinking.delta", { text: "◉_◉ reasoning..." });
      gatewayMocks.emit("status.update", { text: "⏳ Retrying in 4.7s" });
    });

    // Nothing was appended as a turn…
    expect(turns()).toHaveLength(0);
    // …but the operator can still see what is happening.
    const status = container.querySelector('[aria-live="polite"]');
    expect(status?.textContent).toContain("Retrying");
  });
});

describe("composer", () => {
  it("does not submit an empty message", async () => {
    await render(<ChatTranscript />);
    const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
    expect(send?.disabled).toBe(true);
    expect(gatewayMocks.request).not.toHaveBeenCalledWith("prompt.submit", expect.anything(), expect.anything());
  });

  it("hands a slash command to slashExec rather than prompt.submit", async () => {
    await render(<ChatTranscript />);
    const ta = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;

    await act(async () => {
      setter.call(ta, "/help");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click();
    });

    expect(slashMocks.executeSlash).toHaveBeenCalledTimes(1);
    const call = slashMocks.executeSlash.mock.calls[0]![0] as unknown as SlashCall;
    expect(call.command).toBe("/help");
    // Both halves of the contract slashExec declares must be supplied.
    expect(typeof call.callbacks.sys).toBe("function");
    expect(typeof call.callbacks.send).toBe("function");
  });

  it("submits plain text straight to prompt.submit", async () => {
    await render(<ChatTranscript />);
    const ta = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;

    await act(async () => {
      setter.call(ta, "hello");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click();
    });

    expect(slashMocks.executeSlash).not.toHaveBeenCalled();
    const submitted = gatewayMocks.request.mock.calls.some(
      (c) => c[0] === "prompt.submit",
    );
    expect(submitted).toBe(true);
  });
});

describe("blocking prompts", () => {
  const buttons = () =>
    [...container.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
  const clickText = async (text: string) => {
    const btn = [...container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === text,
    );
    if (!btn) throw new Error(`no button labelled ${text}; have: ${buttons().join(" | ")}`);
    await act(async () => btn.click());
  };

  /**
   * The option list is computed server-side and is not always the full set:
   * a smart-denied command legitimately offers only ["once", "deny"].
   * Hardcoding four buttons would hand the operator an "Always allow" the
   * server then refuses — a dead control on the one card that must be
   * trustworthy.
   */
  it("renders exactly the choices the server offered", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("approval.request", {
        request_id: "r1",
        choices: ["once", "deny"],
        command: "rm -rf build",
      }),
    );

    expect(buttons()).toContain("Allow once");
    expect(buttons()).toContain("Deny");
    expect(buttons()).not.toContain("Always allow");
    expect(buttons()).not.toContain("Allow this session");
    expect(container.textContent).toContain("rm -rf build");
  });

  it("answers approval.respond with the request id and choice", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("approval.request", {
        request_id: "r2",
        choices: ["once", "session", "always", "deny"],
      }),
    );
    await clickText("Allow this session");

    const call = gatewayMocks.request.mock.calls.find((c) => c[0] === "approval.respond");
    expect(call, "approval.respond was never sent").toBeTruthy();
    expect(call![1]).toMatchObject({ request_id: "r2", choice: "session" });
    // Card is gone once answered — the turn is no longer blocked.
    expect(buttons()).not.toContain("Deny");
  });

  it("clears the card when the prompt is resolved elsewhere", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("approval.request", { request_id: "r3", choices: ["once", "deny"] }),
    );
    expect(buttons()).toContain("Deny");

    // Another client answered, or the server timed it out.
    await act(async () => gatewayMocks.emit("approval.received", {}));
    expect(buttons()).not.toContain("Deny");
  });

  it("answers a single clarify and closes", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("clarify.request", {
        request_id: "c1",
        question: "Which environment?",
        choices: ["staging", "production"],
      }),
    );
    expect(container.textContent).toContain("Which environment?");

    await clickText("staging");

    const call = gatewayMocks.request.mock.calls.find((c) => c[0] === "clarify.respond");
    expect(call![1]).toMatchObject({ request_id: "c1", answer: "staging" });
    // No question_id on the single form.
    expect(call![1]).not.toHaveProperty("question_id");
    expect(container.textContent).not.toContain("Which environment?");
  });

  /**
   * Batch clarify unblocks only once EVERY qid is answered. A card that closed
   * on the first reply would leave the agent waiting on a question the
   * operator can no longer see.
   */
  it("keeps a batch clarify open until every question is answered", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("clarify.request", {
        request_id: "c2",
        questions: [
          { qid: "q1", question: "Which environment?", choices: ["staging", "production"] },
          { qid: "q2", question: "Run migrations?", choices: ["yes", "no"] },
        ],
      }),
    );

    await clickText("staging");

    const first = gatewayMocks.request.mock.calls.find((c) => c[0] === "clarify.respond");
    expect(first![1]).toMatchObject({ request_id: "c2", question_id: "q1", answer: "staging" });

    // Second question still on screen, first one locked.
    expect(container.textContent).toContain("Run migrations?");
    expect(container.textContent).toContain("✓ staging");
  });

  it("replays answers the server already has after a reconnect", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("clarify.request", {
        request_id: "c3",
        questions: [
          { qid: "q1", question: "Which environment?", choices: ["staging"] },
          { qid: "q2", question: "Run migrations?", choices: ["yes", "no"] },
        ],
        answers: { q1: "staging" },
      }),
    );
    // q1 arrives already locked, so it must not present as unanswered.
    expect(container.textContent).toContain("✓ staging");
    expect(buttons()).toContain("yes");
  });
});

describe("tool lifecycle", () => {
  it("renders a running tool and closes it on complete", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("tool.start", { tool_id: "t1", name: "execute_code", args_text: "ls -la" }),
    );
    expect(turns()[0]).toContain("execute_code ls -la");
    expect(container.querySelector(".animate-spin")).toBeTruthy();

    await act(async () =>
      gatewayMocks.emit("tool.complete", { tool_id: "t1", name: "execute_code", args_text: "ls -la" }),
    );
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  /**
   * Tools interleave — a subagent can open one while another is still open —
   * so completion must match on tool_id. Closing "the last one" would leave
   * the wrong row spinning forever.
   */
  it("matches completion by tool_id, not by position", async () => {
    await render(<ChatTranscript />);
    await act(async () => {
      gatewayMocks.emit("tool.start", { tool_id: "a", name: "read_file", args_text: "one.ts" });
      gatewayMocks.emit("tool.start", { tool_id: "b", name: "read_file", args_text: "two.ts" });
      // The FIRST one finishes first.
      gatewayMocks.emit("tool.complete", { tool_id: "a", name: "read_file", args_text: "one.ts" });
    });

    const rows = [...container.querySelectorAll("ol li")];
    expect(rows[0]!.querySelector(".animate-spin")).toBeNull();
    expect(rows[1]!.querySelector(".animate-spin")).toBeTruthy();
  });

  it("never leaves a tool spinning after the turn ends", async () => {
    await render(<ChatTranscript />);
    await act(async () => {
      gatewayMocks.emit("tool.start", { tool_id: "z", name: "search_files" });
      // No tool.complete — the turn just ends.
      gatewayMocks.emit("message.complete", { text: "done" });
    });
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("resuming a session", () => {
  /**
   * `session.resume` mints a NEW live id and returns the persisted messages.
   * Handing the durable id to `session.history` instead fails with 4001 —
   * that method reads the live registry, not the store.
   */
  it("loads history and adopts the live id, not the durable one", async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === "session.list") {
        return { sessions: [{ id: "20260101_aaa", title: "Yesterday", message_count: 2 }] };
      }
      if (method === "session.resume") {
        return {
          session_id: "live99",
          messages: [
            { role: "user", text: "hello" },
            { role: "assistant", text: "hi there" },
          ],
        };
      }
      return {};
    });

    await render(<ChatTranscript />);

    // The trigger button is gone from the composer — Ctrl/Cmd+K is now the
    // only way to open the picker.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
    await act(async () => {
      container.querySelector<HTMLElement>('[role="option"]')!.click();
    });

    const call = gatewayMocks.request.mock.calls.find((c) => c[0] === "session.resume");
    expect(call![1]).toMatchObject({ session_id: "20260101_aaa" });
    expect(turns()).toHaveLength(2);
    expect(turns()[0]).toContain("hello");
    expect(turns()[1]).toContain("hi there");

    // The live id is no longer printed anywhere, so prove it was adopted the
    // way it actually matters: the next request carries it, not the durable id
    // that was passed to session.resume.
    await act(async () => {
      const box = container.querySelector<HTMLTextAreaElement>("#chat-composer")!;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(box, "next message");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLTextAreaElement>("#chat-composer")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
    });
    const submit = gatewayMocks.request.mock.calls.find((c) => c[0] === "prompt.submit");
    expect(submit![1]).toMatchObject({ session_id: "live99" });
  });
});

describe("multi-part turns", () => {
  /**
   * Seen on screen before it was seen in a test: a tool-using turn emits
   * message.start twice — once before the tool call, once for the answer
   * after it. `finishTurn` only closes the last open turn, so the first one
   * kept a spinner forever and rendered as an empty bubble that never
   * resolved.
   */
  it("does not leave an empty assistant bubble spinning before a tool call", async () => {
    await render(<ChatTranscript />);
    await act(async () => {
      gatewayMocks.emit("message.start");
      gatewayMocks.emit("tool.start", { tool_id: "t1", name: "terminal", args_text: "echo hi" });
      gatewayMocks.emit("tool.complete", { tool_id: "t1", name: "terminal", args_text: "echo hi" });
      gatewayMocks.emit("message.start");
      gatewayMocks.emit("message.delta", { text: "done" });
      gatewayMocks.emit("message.complete", { text: "done" });
    });

    // The empty first turn is gone; only the tool row and the answer remain.
    expect(turns()).toHaveLength(2);
    expect(turns()[0]).toContain("terminal");
    expect(turns()[1]).toContain("done");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps an assistant turn that did receive text", async () => {
    await render(<ChatTranscript />);
    await act(async () => {
      gatewayMocks.emit("message.start");
      gatewayMocks.emit("message.delta", { text: "first part" });
      // A second start must not erase a turn that has content.
      gatewayMocks.emit("message.start");
      gatewayMocks.emit("message.delta", { text: "second part" });
    });
    expect(turns()).toHaveLength(2);
    expect(turns()[0]).toContain("first part");
    expect(turns()[1]).toContain("second part");
  });
});

describe("interleaved tool and text", () => {
  /**
   * The real event order for a tool-using turn, taken off the wire:
   *   message.start → tool.start → tool.complete → message.delta → message.complete
   *
   * By the time the text arrives the LAST entry is the tool row, so a handler
   * that only inspects the tail opens a second bubble and abandons the first.
   * That is what shipped, and what the screenshot caught.
   */
  it("streams into the open assistant turn even after a tool row", async () => {
    await render(<ChatTranscript />);
    await act(async () => {
      gatewayMocks.emit("message.start");
      gatewayMocks.emit("tool.start", { tool_id: "t1", name: "terminal", args_text: "echo hi" });
      gatewayMocks.emit("tool.complete", { tool_id: "t1", name: "terminal", args_text: "echo hi" });
      gatewayMocks.emit("message.delta", { text: "the answer" });
      gatewayMocks.emit("message.complete", { text: "the answer" });
    });

    const rows = turns();
    expect(rows).toHaveLength(2);
    // Natural reading order: the tool that produced the answer comes first.
    expect(rows[0]).toContain("terminal");
    expect(rows[1]).toContain("the answer");
    expect(rows.some((t) => t.trim() === "")).toBe(false);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("clarify card lifecycle", () => {
  const clickText = async (text: string) => {
    const btn = [...container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === text,
    );
    if (!btn) throw new Error(`no button labelled ${text}`);
    await act(async () => btn.click());
  };

  /**
   * Caught on screen, not in a test: the clarify tool emits the BATCH form
   * even for a single question, so the card locked the answer and then hung
   * around forever — the agent had already moved on. It must close exactly
   * when the last qid is answered, which is when the server unblocks.
   */
  it("closes a one-question batch once its only answer lands", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("clarify.request", {
        request_id: "c9",
        questions: [{ qid: "q1", question: "Which environment?", choices: ["staging", "production"] }],
      }),
    );
    expect(container.querySelector('[aria-label="Question from the agent"]')).toBeTruthy();

    await clickText("staging");

    expect(container.querySelector('[aria-label="Question from the agent"]')).toBeNull();
  });

  it("stays open while any question is still unanswered", async () => {
    await render(<ChatTranscript />);
    await act(async () =>
      gatewayMocks.emit("clarify.request", {
        request_id: "c10",
        questions: [
          { qid: "q1", question: "Which environment?", choices: ["staging"] },
          { qid: "q2", question: "Run migrations?", choices: ["yes", "no"] },
        ],
      }),
    );
    await clickText("staging");
    expect(container.querySelector('[aria-label="Question from the agent"]')).toBeTruthy();

    await clickText("yes");
    expect(container.querySelector('[aria-label="Question from the agent"]')).toBeNull();
  });
});

describe("banner and attachments", () => {
  /**
   * Counts ENABLED toolsets, not summed tool_counts. On the live gateway the
   * sum is 1354 across 61 toolsets — a number that means nothing to anyone.
   */
  it("counts enabled toolsets and skill categories", async () => {
    gatewayMocks.request.mockImplementation(async (method: string) => {
      if (method === "tools.list") {
        return {
          toolsets: [
            { enabled: true },
            { enabled: false },
            { enabled: true },
            { enabled: false },
          ],
        };
      }
      if (method === "skills.manage") {
        return { skills: { alpha: ["a", "b"], beta: ["c"], gamma: ["d", "e", "f"] } };
      }
      return {};
    });

    await render(<ChatTranscript />);
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("2 toolsets");
    expect(container.textContent).toContain("6 skills in 3 categories");
  });

  /**
   * The dashboard can be a browser on a different host from the gateway, so a
   * local PATH is meaningless there — the gateway's own docs say that is why
   * `data_url` exists. Sending a bare path would silently attach nothing.
   */
  it("uploads bytes rather than a path, and routes images separately", async () => {
    const seen: Array<{ method: string; params?: Record<string, unknown> }> = [];
    gatewayMocks.request.mockImplementation(
      async (method: string, params?: Record<string, unknown>) => {
        seen.push({ method, params });
        if (method === "session.create") return { session_id: "s1" };
        if (method === "file.attach") return { ref_text: "@file:notes.txt" };
        if (method === "image.attach_bytes") return { ref_text: "@image:shot.png" };
        return {};
      },
    );

    await render(<ChatTranscript />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    const files = [
      new File(["hello"], "notes.txt", { type: "text/plain" }),
      new File(["bytes"], "shot.png", { type: "image/png" }),
    ];
    Object.defineProperty(input, "files", { value: files, configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // FileReader is async even for tiny blobs.
      await new Promise((r) => setTimeout(r, 50));
    });

    const fileCall = seen.find((c) => c.method === "file.attach");
    const imageCall = seen.find((c) => c.method === "image.attach_bytes");

    expect(fileCall, "a non-image must go to file.attach").toBeTruthy();
    expect(String(fileCall!.params!.data_url)).toMatch(/^data:/);
    expect(imageCall, "an image must go to image.attach_bytes").toBeTruthy();
    expect(String(imageCall!.params!.content_base64)).toMatch(/^data:/);

    // Both refs land in the composer, not sent on their own — the operator
    // still has to say what the file is for.
    const ta = container.querySelector("textarea")!;
    expect(ta.value).toContain("@file:notes.txt");
    expect(ta.value).toContain("@image:shot.png");
    expect(seen.some((c) => c.method === "prompt.submit")).toBe(false);
  });

  it("refuses a file over the shared size cap instead of trying to send it", async () => {
    const seen: string[] = [];
    gatewayMocks.request.mockImplementation(async (method: string) => {
      seen.push(method);
      if (method === "session.create") return { session_id: "s1" };
      return {};
    });

    await render(<ChatTranscript />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const huge = new File(["x"], "huge.bin", { type: "application/octet-stream" });
    // 17 MB — one over DATA_URL_READ_DEFAULT_MAX_MB.
    Object.defineProperty(huge, "size", { value: 17 * 1024 * 1024 });
    Object.defineProperty(input, "files", { value: [huge], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(seen).not.toContain("file.attach");
    expect(turns().join(" ")).toContain("attachment limit");
  });
});

describe("scrolling", () => {
  /** jsdom reports every element as zero-height, so the geometry the scroll
   *  logic reads has to be supplied explicitly. */
  const setGeometry = (el: Element, { scrollHeight = 0, clientHeight = 0, scrollTop = 0 }) => {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  };
  const scroller = () => container.querySelector('[class*="overflow-y-auto"]')!;
  const jumpButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Jump to latest"]');

  it("offers no jump button while the reader is at the bottom", async () => {
    await render(<ChatTranscript />);
    await act(async () => gatewayMocks.emit("message.delta", { text: "hello" }));
    setGeometry(scroller(), { scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    expect(jumpButton()).toBeNull();
  });

  it("offers it once they scroll away, and hides it again on return", async () => {
    await render(<ChatTranscript />);
    await act(async () => gatewayMocks.emit("message.delta", { text: "hello" }));

    // 400px from the bottom — well past the 48px slack.
    setGeometry(scroller(), { scrollHeight: 1000, clientHeight: 500, scrollTop: 100 });
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    expect(jumpButton()).toBeTruthy();

    setGeometry(scroller(), { scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    expect(jumpButton()).toBeNull();
  });

  it("scrolls to the bottom when pressed", async () => {
    await render(<ChatTranscript />);
    await act(async () => gatewayMocks.emit("message.delta", { text: "hello" }));
    const el = scroller();
    setGeometry(el, { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
    const scrollTo = vi.fn();
    Object.defineProperty(el, "scrollTo", { value: scrollTo, configurable: true });

    await act(async () => el.dispatchEvent(new Event("scroll")));
    await act(async () => jumpButton()!.click());

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    // Pressing it re-attaches autoscroll, so the button goes away.
    expect(jumpButton()).toBeNull();
  });

  it("shows nothing on an empty transcript", async () => {
    await render(<ChatTranscript />);
    setGeometry(scroller(), { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 });
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    // Scrolled away, but there is no "latest" to jump to yet.
    expect(jumpButton()).toBeNull();
  });
});

/**
 * Arrival props. The Sessions page hands over `?resume=<id>` and the Skills
 * page hands over `?learn=<text>`; both used to land on the xterm surface at
 * /chat, which no longer has a sidebar entry, so they land here now.
 */
describe("arrival hand-off", () => {
  const resumeCalls = () =>
    gatewayMocks.request.mock.calls.filter((c) => c[0] === "session.resume");

  it("reopens the handed-over session once, and only once", async () => {
    gatewayMocks.request.mockImplementation(async (method: string) =>
      method === "session.resume"
        ? { session_id: "live-1", messages: [{ role: "user", text: "earlier question" }] }
        : { session_id: "s1" },
    );

    await render(<ChatTranscript resumeSessionId="durable-42" />);
    expect(resumeCalls()).toHaveLength(1);
    expect(resumeCalls()[0]![1]).toMatchObject({ session_id: "durable-42" });
    // The persisted turns come back on screen, not an empty transcript.
    expect(turns().join(" ")).toContain("earlier question");

    // A re-render must not mint a second live session.
    await act(async () => root.render(<ChatTranscript resumeSessionId="durable-42" />));
    expect(resumeCalls()).toHaveLength(1);
  });

  it("resumes nothing when no session was handed over", async () => {
    await render(<ChatTranscript />);
    expect(resumeCalls()).toHaveLength(0);
  });

  /**
   * Resuming against a closed socket only writes an error into the transcript,
   * so the effect has to wait for the gateway rather than fire on mount.
   */
  it("waits for the socket instead of resuming into a closed one", async () => {
    let publish: ((s: string) => void) | null = null;
    gatewayMocks.onState.mockImplementation((fn: (s: string) => void) => {
      publish = fn;
      fn("connecting");
      return () => {};
    });

    await render(<ChatTranscript resumeSessionId="durable-42" />);
    expect(resumeCalls()).toHaveLength(0);

    await act(async () => publish?.("open"));
    expect(resumeCalls()).toHaveLength(1);
  });

  /**
   * A cold gateway took ~25s to answer session.resume when this was tested
   * against a live server. With no marker the surface is indistinguishable
   * from one that ignored the hand-off.
   */
  it("says it is reopening while the resume is in flight, then clears", async () => {
    let settle: ((v: Record<string, unknown>) => void) | null = null;
    gatewayMocks.request.mockImplementation(
      async (method: string) =>
        method === "session.resume"
          ? new Promise<Record<string, unknown>>((res) => {
              settle = res;
            })
          : { session_id: "s1" },
    );

    await render(<ChatTranscript resumeSessionId="durable-42" />);
    const status = () => container.querySelector('[aria-live="polite"]')?.textContent ?? "";
    expect(status()).toContain("Reopening session");

    await act(async () => settle?.({ session_id: "live-1", messages: [] }));
    expect(status()).not.toContain("Reopening session");
  });

  it("seeds the composer with the Skills page's learn text", async () => {
    await render(<ChatTranscript initialInput="Learn the skill at ./foo" />);
    expect(container.querySelector("textarea")!.value).toBe("Learn the skill at ./foo");
  });
});
