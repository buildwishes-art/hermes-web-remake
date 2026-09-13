/**
 * ChatTranscript — a message surface over the tui_gateway JSON-RPC socket.
 *
 * This is the piece the dashboard was missing. Everything under it already
 * existed: `GatewayClient` speaks the protocol, `slashExec` runs slash
 * commands, `SlashPopover` completes them. All three were written expecting a
 * transcript host to plug into — `slashExec` even declares the two callbacks
 * (`sys`, `send`) it needs. This component is that host.
 *
 * The event contract below was verified against a live gateway, not read off
 * the source. A prompt asking the agent to count to ten arrived as four
 * separate `message.delta` frames:
 *
 *     "1\n2"  →  "\n3\n4\n5\n6"  →  "\n7\n8\n9\n1"  →  "0"
 *
 * Note where the "10" splits across a frame boundary. That is token-level
 * streaming, so the transcript appends deltas as they land rather than waiting
 * for `message.complete`.
 *
 * `message.complete` is still treated as authoritative for the final text: it
 * carries the assembled string plus a usage object, and on a provider failure
 * it carries the error message instead of any assistant output.
 *
 * The xterm terminal on /chat is untouched and keeps its own PTY session.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ArrowDown, ArrowUp, Loader2, Square } from "lucide-react";
// Reuse the shared cap rather than inventing one: main and the desktop
// renderer already agree on this number, and a third value would be a third
// thing to keep in sync.
import { DATA_URL_READ_DEFAULT_MAX_MB } from "@hermes/shared";
import { cn } from "@/lib/utils";
import { MessageActions } from "@/components/MessageActions";
import { ToolTurn } from "@/components/ToolTurn";
import { UserMessageActions } from "@/components/UserMessageActions";
import { GatewayClient, type ConnectionState } from "@/lib/gatewayClient";
import { executeSlash } from "@/lib/slashExec";
import { SlashPopover, type SlashPopoverHandle } from "@/components/SlashPopover";
import { CommandPanel, type PanelItem } from "@/components/CommandPanel";
import { NEW_CHAT_EVENT } from "@/components/SidebarRecents";
import { ComposerAddMenu } from "@/components/ComposerAddMenu";
import { ComposerModelButton } from "@/components/ComposerModelButton";
import {
  applyMode,
  ComposerModeButton,
  readMode,
  type ComposerMode,
} from "@/components/ComposerModeButton";
import {
  applySendTransforms,
  getToolRenderer,
  onToolRendererRegistered,
  PluginSlot,
} from "@/plugins";
import { monthGroup } from "@/lib/command-panel";
import { useCommandPanelKey } from "@/lib/command-panel";
import {
  ChatPrompt,
  type ApprovalPrompt,
  type ClarifyPrompt,
  type PendingPrompt,
} from "@/components/ChatPrompt";

/** `prompt.submit` returns as soon as the turn starts streaming, but the RPC
 *  itself is held open by the gateway for the life of the turn. */
const SUBMIT_TIMEOUT_MS = 1_800_000;

type Role = "user" | "assistant" | "system" | "tool";

interface Turn {
  id: string;
  role: Role;
  text: string;
  /** Assistant turn still receiving deltas. */
  streaming?: boolean;
  /** Populated from `message.complete`. */
  usage?: TurnUsage;
  /** Tool turns only. `toolId` correlates start with complete. */
  toolId?: string;
  toolName?: string;
  running?: boolean;
  /** What the tool returned. Absent while it is still running. */
  output?: string;
}

interface TurnUsage {
  model?: string;
  input?: number;
  output?: number;
  total?: number;
  context_percent?: number;
}

interface DeltaPayload {
  text?: string;
}

interface CompletePayload {
  text?: string;
  usage?: TurnUsage;
}

interface StatusPayload {
  text?: string;
}

interface ToolPayload {
  tool_id?: string;
  name?: string;
  args_text?: string;
  preview?: string;
  /** `_on_tool_complete` sends the parsed JSON when the result is JSON, and
   *  the raw string otherwise — so this is genuinely unknown at the type
   *  level, not a string that happens to be typed loosely. */
  result?: unknown;
  args?: Record<string, unknown>;
}

interface HistoryMessage {
  role?: string;
  /** The gateway calls this `text`, not `content`. */
  text?: string;
}

interface ToolsetSummary {
  enabled?: boolean;
}

interface Banner {
  toolsets: number;
  skills: number;
  categories: number;
}

interface AttachResult {
  /** `@file:…` / `@image:…` — pasted into the composer so the agent can read it. */
  ref_text?: string;
}

interface SessionSummary {
  id?: string;
  session_id?: string;
  title?: string;
  message_count?: number;
  /** Unix seconds. Used to group rows by month, as the reference panel does. */
  started_at?: number;
  source?: string;
}

interface ResumeResult {
  /** A NEW live id — not the durable id that was passed in. */
  session_id?: string;
  messages?: HistoryMessage[];
}

interface ApprovalRequestPayload {
  request_id?: string;
  choices?: string[];
  command?: string;
}

interface ClarifyQuestionWire {
  qid?: string;
  question?: string;
  choices?: string[];
  multi_select?: boolean;
}

interface ClarifyRequestPayload {
  request_id?: string;
  question?: string;
  choices?: string[];
  multi_select?: boolean;
  questions?: ClarifyQuestionWire[];
  answers?: Record<string, string>;
}

/** Normalise the single- and batch-question forms into one shape. */
function toClarifyPrompt(p: ClarifyRequestPayload): ClarifyPrompt {
  const questions = p.questions?.length
    ? p.questions.map((q) => ({
        qid: q.qid,
        question: q.question ?? "",
        choices: q.choices,
        multiSelect: Boolean(q.multi_select),
      }))
    : [{ question: p.question ?? "", choices: p.choices, multiSelect: Boolean(p.multi_select) }];

  return {
    kind: "clarify",
    requestId: p.request_id ?? "",
    questions,
    answered: p.answers ?? {},
  };
}

/** One readable line for a tool call. `args_text` is the gateway's own
 *  rendering when it has one; otherwise fall back to compact JSON. */
function toolSummary(p: ToolPayload): string {
  const detail = p.args_text ?? p.preview ?? (p.args ? JSON.stringify(p.args) : "");
  return detail ? `${p.name ?? "tool"} ${detail}` : p.name ?? "tool";
}

/**
 * What the tool returned, as text.
 *
 * `tool.complete` has always carried this and the transcript has always
 * dropped it, so the Output half of an expanded tool row was never populated:
 * the only text the row was handed was the ARGUMENT summary. Anything that
 * wants to render what a tool actually returned needs this, not that.
 */
function toolOutput(p: ToolPayload): string {
  const raw = p.result;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

/** Monotonic ids without Date.now/Math.random so turns stay stable in tests. */
let turnSeq = 0;
const nextTurnId = () => `t${++turnSeq}`;

const SUGGESTIONS: Array<{ title: string; body: string }> = [
  { title: "Explain this repo", body: "Summarise what this project does and how it is laid out" },
  { title: "Find a bug", body: "Look for a correctness problem in the code I changed most recently" },
  { title: "Write a test", body: "Add a test for the behaviour we just discussed" },
  { title: "Run something", body: "Check the build and tell me what breaks" },
];

interface ChatTranscriptProps {
  /**
   * Durable session id to reopen on arrival — the Sessions page hands this
   * over when you pick "Resume in Chat". Read from the URL by the page, not
   * here: this component stays router-free so it can be mounted anywhere.
   */
  resumeSessionId?: string | null;
  /** Text to seed the composer with, from the Skills page "learn" hand-off. */
  initialInput?: string | null;
  /**
   * Open the Models page from the composer's model picker. Passed down rather
   * than navigated to here, for the same reason as `resumeSessionId`: this
   * component stays router-free so it can be mounted anywhere.
   */
  onOpenModelSettings?(): void;
}

export function ChatTranscript({
  resumeSessionId = null,
  initialInput = null,
  onOpenModelSettings,
}: ChatTranscriptProps = {}) {
  const gw = useMemo(() => new GatewayClient(), []);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<string>("");
  const [input, setInput] = useState(initialInput ?? "");
  // Build is the neutral default; Plan persists across reloads, the same way
  // the sidebar's open state does.
  const [mode, setMode] = useState<ComposerMode>(() => readMode());
  // Who we are ASKING, reported up by the model button. Distinct from
  // `usage.model`, which says who ANSWERED and only exists once the reply
  // lands — for a router combo those are different names.
  const [askingModel, setAskingModel] = useState("");
  // Who is actually answering, announced from the first stream chunk. Empty
  // until that arrives — which is when `askingModel` is all we have.
  const [answeringModel, setAnsweringModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [attaching, setAttaching] = useState(false);
  /** Mirrors `pinnedRef` for rendering. The ref drives the scroll effect (it
   *  must be readable without a re-render); this drives the jump button. */
  const [pinned, setPinned] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const openPanel = useCallback(() => setPanelOpen(true), []);

  const sessionRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<SlashPopoverHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Transcript mutation helpers ──────────────────────────────────────
  // All of these are stable so the subscription effect below runs once.

  const push = useCallback((role: Role, text: string) => {
    setTurns((prev) => [...prev, { id: nextTurnId(), role, text }]);
  }, []);

  /**
   * Find the assistant turn still open, wherever it is.
   *
   * NOT "the last turn": a tool-using turn interleaves
   * `message.start → tool.start → tool.complete → message.delta`, so by the
   * time text arrives the last entry is the tool row. Checking only the tail
   * opened a second bubble and left the first one spinning forever — visible
   * on screen as an empty message that never resolves.
   */
  const openAssistantIndex = (list: Turn[]) =>
    list.findLastIndex((t) => t.role === "assistant" && t.streaming);

  const appendDelta = useCallback((chunk: string) => {
    if (!chunk) return;
    setTurns((prev) => {
      const i = openAssistantIndex(prev);
      // A delta with no open turn still has to land somewhere — open one
      // rather than dropping the token.
      if (i === -1) {
        return [...prev, { id: nextTurnId(), role: "assistant", text: chunk, streaming: true }];
      }
      const next = [...prev];
      next[i] = { ...next[i]!, text: next[i]!.text + chunk };
      return next;
    });
  }, []);

  const finishTurn = useCallback((text: string, usage?: TurnUsage) => {
    setTurns((prev) => {
      const i = openAssistantIndex(prev);
      if (i === -1) {
        // Provider failed before any delta: `message.complete` carries the
        // error text and there is no open turn to close.
        return text ? [...prev, { id: nextTurnId(), role: "system", text }] : prev;
      }
      const next = [...prev];
      // `complete` is authoritative — deltas can be lossy across a reconnect.
      next[i] = { ...next[i]!, text: text || next[i]!.text, streaming: false, usage };
      return next;
    });
  }, []);

  /**
   * A capability summary for the empty state, in the spirit of the terminal's
   * opening banner.
   *
   * Deliberately NOT a copy of the terminal's "25 tools" figure. `tools.list`
   * reports 61 toolsets whose tool_counts sum to 1354, of which 18 are enabled
   * (53 tool slots, 52 unique names) — none of which is 25, so the terminal
   * derives that number somewhere this RPC does not expose. Rather than ship a
   * number that merely looks plausible, this counts the one thing the payload
   * states outright: how many toolsets are switched on.
   *
   * `tools.list` falls back to the configured toolsets when no session exists,
   * so it can run before the operator has sent anything.
   */
  const loadBanner = useCallback(async () => {
    try {
      const [tools, skills] = await Promise.all([
        gw.request<{ toolsets?: ToolsetSummary[] }>("tools.list", {}),
        gw.request<{ skills?: Record<string, string[]> }>("skills.manage", { action: "list" }),
      ]);
      const enabled = (tools.toolsets ?? []).filter((t) => t.enabled).length;
      const cats = Object.values(skills.skills ?? {});
      setBanner({
        toolsets: enabled,
        skills: cats.reduce((n, list) => n + list.length, 0),
        categories: cats.length,
      });
    } catch {
      // A missing banner is cosmetic — never worth a transcript line.
    }
  }, [gw]);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await gw.request<{ sessions?: SessionSummary[] }>("session.list", {});
      setSessions(res.sessions ?? []);
    } catch {
      // A missing picker is not worth a transcript line.
    }
  }, [gw]);

  // ── Gateway wiring ───────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];

    offs.push(gw.onState((s) => { if (!disposed) setConnection(s); }));

    offs.push(gw.on<unknown>("message.start", () => {
      if (disposed) return;
      setStatus("");
      // Deliberately does NOT create a bubble. `message.start` fires before
      // the tool calls that a turn makes, so creating one here puts the answer
      // ABOVE the tool that produced it — and leaves an empty bubble on screen
      // for as long as the tools run. The turn is created lazily by the first
      // delta instead, which lands it after the tool rows in the natural
      // reading order. Closing any turn still open keeps consecutive answers
      // in one turn each.
      setTurns((prev) =>
        prev
          .map((t) => (t.role === "assistant" && t.streaming ? { ...t, streaming: false } : t))
          .filter((t) => !(t.role === "assistant" && t.text === "")),
      );
    }));

    offs.push(gw.on<DeltaPayload>("message.delta", (e) => {
      if (!disposed) appendDelta(e.payload?.text ?? "");
    }));

    offs.push(gw.on<CompletePayload>("message.complete", (e) => {
      if (disposed) return;
      finishTurn(e.payload?.text ?? "", e.payload?.usage);
      // A tool whose complete never arrived would otherwise spin forever.
      setTurns((prev) => prev.map((t) => (t.running ? { ...t, running: false } : t)));
      setStatus("");
      setBusy(false);
    }));

    // Tool lifecycle. `tool_progress_mode` defaults to "all", so these arrive
    // without the client opting in.
    offs.push(gw.on<ToolPayload>("tool.start", (e) => {
      if (disposed) return;
      const p = e.payload ?? {};
      setTurns((prev) => [
        ...prev,
        {
          id: nextTurnId(),
          role: "tool",
          text: toolSummary(p),
          toolId: p.tool_id,
          toolName: p.name,
          running: true,
        },
      ]);
    }));

    offs.push(gw.on<ToolPayload>("tool.complete", (e) => {
      if (disposed) return;
      const p = e.payload ?? {};
      setTurns((prev) => {
        // Match on tool_id: tools interleave, so "the last one" is wrong.
        const i = prev.findLastIndex((t) => t.role === "tool" && t.toolId === p.tool_id);
        if (i === -1) {
          return [
            ...prev,
            {
              id: nextTurnId(),
              role: "tool",
              text: toolSummary(p),
              toolId: p.tool_id,
              // Carried here too, not only on `tool.start`: a completion with
              // no matching start is how a reconnect mid-turn arrives, and
              // without the name a plugin renderer could not claim it.
              toolName: p.name,
              output: toolOutput(p),
            },
          ];
        }
        const next = [...prev];
        next[i] = { ...next[i]!, running: false, text: toolSummary(p), output: toolOutput(p) };
        return next;
      });
    }));

    // Blocking prompts: the turn stays open server-side until answered, so
    // these are state rather than transcript entries.
    offs.push(gw.on<ApprovalRequestPayload>("approval.request", (e) => {
      if (disposed) return;
      const p = e.payload ?? {};
      setPending({
        kind: "approval",
        requestId: p.request_id ?? "",
        // Never invent the option list: a smart-denied command legitimately
        // offers only ["once", "deny"], and showing "always" there would
        // hand the operator a button the server will refuse.
        choices: p.choices ?? ["once", "deny"],
        command: p.command,
      } satisfies ApprovalPrompt);
    }));

    offs.push(gw.on<ClarifyRequestPayload>("clarify.request", (e) => {
      if (!disposed) setPending(toClarifyPrompt(e.payload ?? {}));
    }));

    // Resolved or abandoned elsewhere (another client answered, or the
    // server timed the prompt out) — the card must not linger.
    for (const type of ["approval.received", "clarify.expire", "approval.expire"] as const) {
      offs.push(gw.on(type, () => { if (!disposed) setPending(null); }));
    }

    // Reasoning and retry progress are transient: they describe what is
    // happening now, not what was said. They belong on a status line, not in
    // the transcript, or every turn ends up padded with "◉_◉ reasoning...".
    for (const type of ["thinking.delta", "reasoning.delta", "status.update"] as const) {
      offs.push(gw.on<StatusPayload>(type, (e) => {
        if (disposed) return;
        // `kind: "model"` rides the status channel but is not status text: the
        // agent emits it from the first stream chunk, naming the model that is
        // actually answering. Letting it fall through to setStatus would
        // replace "◉_◉ reasoning..." with a bare model id.
        if ((e.payload as { kind?: string } | undefined)?.kind === "model") {
          setAnsweringModel((e.payload?.text ?? "").trim());
          return;
        }
        setStatus((e.payload?.text ?? "").trim());
      }));
    }

    void gw
      .connect()
      .then(() => {
        if (disposed) return;
        void refreshSessions();
        void loadBanner();
      })
      .catch((err: unknown) => {
      if (disposed) return;
      setStatus(err instanceof Error ? err.message : "gateway connect failed");
    });

    return () => {
      disposed = true;
      for (const off of offs) off();
      gw.close();
    };
  }, [gw, appendDelta, finishTurn, refreshSessions, loadBanner]);

  // ── Autoscroll, but only while the reader is at the bottom ───────────

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 48px of slack: a reader sitting a line or two off the bottom still
    // counts as following along, so ordinary wheel jitter does not
    // repeatedly detach and re-attach the autoscroll.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    pinnedRef.current = atBottom;
    setPinned((prev) => (prev === atBottom ? prev : atBottom));
  }, []);

  // Ctrl/Cmd+K opens the picker from anywhere on the surface. Verified free:
  // nothing else in the dashboard binds a modified "k".
  useCommandPanelKey(openPanel);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    pinnedRef.current = true;
    setPinned(true);
  }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, status]);

  // ── Sending ──────────────────────────────────────────────────────────

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionRef.current) return sessionRef.current;
    const res = await gw.request<{ session_id?: string; id?: string }>("session.create", {});
    const sid = res.session_id ?? res.id ?? "";
    sessionRef.current = sid;
    return sid;
  }, [gw]);

  /** The `send` half of slashExec's callback pair. */
  const sendToAgent = useCallback(
    async (text: string) => {
      const sid = await ensureSession();
      setBusy(true);
      // Cleared per turn: a router combo can resolve to a different link than
      // last time, so carrying the previous responder's name into a new turn
      // would state as fact something not yet known.
      setAnsweringModel("");
      try {
        await gw.request("prompt.submit", { session_id: sid, text }, SUBMIT_TIMEOUT_MS);
      } catch (err) {
        setBusy(false);
        push("system", err instanceof Error ? err.message : String(err));
      }
    },
    [ensureSession, gw, push],
  );

  /**
   * Resuming mints a NEW live session id and returns the persisted messages.
   * Passing the durable id straight to `session.history` fails with 4001 —
   * that method reads the live registry, not the store.
   */
  const resumeSession = useCallback(
    async (durableId: string) => {
      if (!durableId) return;
      // A cold gateway can take twenty seconds to answer this, and the request
      // has a 30s ceiling. Without a marker the surface just sits there
      // looking like an empty chat that ignored you.
      setStatus("Reopening session…");
      try {
        const res = await gw.request<ResumeResult>("session.resume", { session_id: durableId }, 30_000);
        const liveId = res.session_id ?? "";
        sessionRef.current = liveId;
        setPending(null);
        setTurns(
          (res.messages ?? [])
            .filter((m) => m.text)
            .map((m) => ({
              id: nextTurnId(),
              role: m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system",
              text: m.text ?? "",
            })),
        );
      } catch (err) {
        push("system", err instanceof Error ? err.message : String(err));
      } finally {
        setStatus("");
      }
    },
    [gw, push],
  );

  /**
   * Reopen the handed-over session once the socket is up. Resuming before the
   * gateway is open only writes an error into the transcript, and the ref
   * makes it a one-shot so a reconnect does not mint a second live id.
   */
  const arrivalResumed = useRef(false);
  useEffect(() => {
    if (!resumeSessionId || arrivalResumed.current) return;
    if (connection !== "open") return;
    arrivalResumed.current = true;
    void resumeSession(resumeSessionId);
  }, [resumeSessionId, connection, resumeSession]);

  /**
   * "New chat" from the sidebar. The route does not change when it is pressed
   * from this very page, so nothing remounts — the reset has to be explicit.
   *
   * Dropping `sessionRef` is the load-bearing part: the next send calls
   * `ensureSession`, which mints a fresh session only when that ref is empty.
   * Clearing the visible turns alone would leave the new messages appended to
   * the old session on the server.
   */
  useEffect(() => {
    const onNewChat = () => {
      sessionRef.current = "";
      setTurns([]);
      setPending(null);
      setStatus("");
      setAnsweringModel("");
      setInput("");
      setBanner(null);
    };
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, []);

  /** The `sys` half. */
  const sys = useCallback((text: string) => push("system", text), [push]);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput("");
      push("user", text);

      if (text.startsWith("/")) {
        // slashExec owns the dispatch; it calls `send` itself for commands
        // that resolve to a message, so this must not also submit.
        const sid = await ensureSession();
        try {
          await executeSlash({ command: text, sessionId: sid, gw, callbacks: { sys, send: sendToAgent } });
        } catch (err) {
          sys(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // Mode applies to the wire, not to the transcript: the bubble above shows
      // what the user typed, while the model receives the directive in front of
      // it. Slash commands are exempt — they returned above — because steering
      // "/model …" toward planning would be nonsense.
      // Plugin transforms run last, on the text the built-ins have already
      // shaped. They cannot see a slash command — that dispatched above — and
      // a misbehaving one is skipped rather than allowed to eat the message.
      await sendToAgent(applySendTransforms(applyMode(text, mode)));
    },
    [busy, push, ensureSession, gw, sys, sendToAgent, mode],
  );

  const respondApproval = useCallback(
    async (choice: string) => {
      const p = pending;
      if (!p || p.kind !== "approval") return;
      setPending(null);
      try {
        await gw.request("approval.respond", {
          session_id: sessionRef.current,
          request_id: p.requestId,
          choice,
        }, 15_000);
      } catch (err) {
        push("system", err instanceof Error ? err.message : String(err));
      }
    },
    [pending, gw, push],
  );

  const respondClarify = useCallback(
    async (answer: string, qid?: string) => {
      const p = pending;
      if (!p || p.kind !== "clarify") return;

      // Batch clarify unblocks only once EVERY qid is answered, so the card
      // locks this question rather than closing on the first reply — and then
      // closes exactly when the last one lands, mirroring the server.
      //
      // Without the "all answered" check a one-question batch (which is what
      // the clarify tool actually emits) locks its answer and then hangs on
      // screen forever, long after the agent has moved on.
      if (qid) {
        const answered = { ...p.answered, [qid]: answer };
        const complete = p.questions.every((q) => !q.qid || answered[q.qid] !== undefined);
        setPending(complete ? null : { ...p, answered });
      } else {
        setPending(null);
      }

      try {
        await gw.request("clarify.respond", {
          session_id: sessionRef.current,
          request_id: p.requestId,
          ...(qid ? { question_id: qid } : {}),
          answer,
        }, 15_000);
      } catch (err) {
        push("system", err instanceof Error ? err.message : String(err));
      }
    },
    [pending, gw, push],
  );

  /**
   * Upload as a data URL, not a path.
   *
   * A path only means something on the machine that produced it; the dashboard
   * can be a browser on a different host from the gateway. The gateway's own
   * docs make that the reason `data_url` exists, so the browser always sends
   * bytes and lets the gateway materialise the file on its side.
   */
  const attachFiles = useCallback(
    async (files: FileList) => {
      const sid = await ensureSession();
      setAttaching(true);
      const refs: string[] = [];
      try {
        for (const file of Array.from(files)) {
          const mb = file.size / (1024 * 1024);
          if (mb > DATA_URL_READ_DEFAULT_MAX_MB) {
            push("system", `${file.name} is ${mb.toFixed(1)} MB — over the ${DATA_URL_READ_DEFAULT_MAX_MB} MB attachment limit.`);
            continue;
          }

          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error ?? new Error("read failed"));
            reader.readAsDataURL(file);
          });

          // Images render to vision tiles; everything else stays a readable
          // artifact the agent's file tools can open.
          const res = file.type.startsWith("image/")
            ? await gw.request<AttachResult>("image.attach_bytes", {
                session_id: sid,
                content_base64: dataUrl,
                filename: file.name,
              }, 120_000)
            : await gw.request<AttachResult>("file.attach", {
                session_id: sid,
                path: file.name,
                data_url: dataUrl,
                name: file.name,
              }, 120_000);

          if (res.ref_text) refs.push(res.ref_text);
        }
      } catch (err) {
        push("system", err instanceof Error ? err.message : String(err));
      } finally {
        setAttaching(false);
      }

      // The ref goes into the composer rather than being sent on its own, so
      // the operator can say what the file is FOR before submitting.
      if (refs.length) setInput((prev) => (prev ? `${prev} ${refs.join(" ")}` : refs.join(" ")));
      textareaRef.current?.focus();
    },
    [ensureSession, gw, push],
  );

  const interrupt = useCallback(async () => {
    if (!sessionRef.current) return;
    try {
      await gw.request("session.interrupt", { session_id: sessionRef.current }, 10_000);
    } catch {
      // Best effort: the turn may already have finished on its own.
    }
    setBusy(false);
    setStatus("");
  }, [gw]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // The completion popover gets first refusal on arrows/tab/enter.
    if (popoverRef.current?.handleKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(input);
    }
  };

  const live = connection === "open";
  const empty = turns.length === 0;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        {/* pb-40, not py-8: the composer floats over this area now, and
            without the reserved space the last message sits under it. */}
        <div className="mx-auto w-full max-w-[860px] px-6 pt-8 pb-56">
          {/* `chat:top` and `chat:bottom` were documented slots that this
              build rendered nowhere — they went with the xterm chat page when
              it was deleted, and nothing re-hung them on the surface that
              replaced it. A slot a plugin can declare but never appear in is
              worse than one that does not exist. */}
          <PluginSlot name="chat:top" />

          {empty ? (
            <>
              <EmptyState onPick={(s) => void submit(s)} banner={banner} />
              {/* The empty state replaces the turn list entirely, so the status
                  needs its own home here — otherwise the first message of a
                  session reports its progress nowhere. */}
              {status && (
                <p className="mt-4 text-sm text-[var(--text-secondary)]" aria-live="polite">
                  {status}
                </p>
              )}
            </>
          ) : (
            <ol className="flex flex-col gap-6">
              {turns.map((t, i) => (
                <TurnView
                  key={t.id}
                  turn={t}
                  // Retry replays the user turn this reply answered, so it is
                  // offered only when there is one to replay — a resumed
                  // transcript can open on an assistant turn with nothing
                  // before it, and a Retry button that resends nothing is a
                  // button that lies. `busy` gates it for the same reason the
                  // composer is gated: two in-flight turns interleave.
                  // Resend and edit both submit as a NEW turn, so they are
                  // gated on `busy` for the same reason the composer is:
                  // two in-flight turns interleave in the transcript.
                  onResend={busy ? undefined : (t: string) => void submit(t)}
                  onRetry={(() => {
                    if (busy) return undefined;
                    const prior = turns.slice(0, i).filter((x) => x.role === "user").at(-1);
                    return prior ? () => void submit(prior.text) : undefined;
                  })()}
                />
              ))}

              {/* The model's progress line, standing where its reply will
                  appear. It used to sit above the composer, which put "what
                  the model is doing" at the opposite end of the screen from
                  "what the model has said" — the reader watched one place and
                  then read another.

                  Only while a turn is in flight AND nothing is streaming yet:
                  once the first token lands, the reply itself is the status,
                  and two indicators would compete. */}
              {status && !turns.some((t) => t.streaming) && (
                <li aria-live="polite">
                  {/* "asking X" — never bare "X". Before the reply we know only
                      who was ASKED; a combo resolves to one of its links and
                      the answer may carry a different name entirely. Printing
                      the requested name unlabelled here, then quietly swapping
                      it for the responder, would read as the model renaming
                      itself mid-turn. */}
                  {(answeringModel || askingModel) && (
                    <p className="mb-1 font-mono-ui text-xs text-[var(--text-tertiary)]">
                      {answeringModel || `asking ${askingModel}`}
                    </p>
                  )}
                  <p className="text-sm text-[var(--text-secondary)]">{status}</p>
                </li>
              )}
            </ol>
          )}
        </div>
      </div>

      {/* Floating, not a docked bar. The divider and the reserved strip below
          it split the surface in two — a place where the conversation stopped
          and a place where the controls lived. Overlaying the scroll area
          instead lets the transcript run behind the composer, so the page
          reads as one surface. The scroller carries matching bottom padding
          so the last message still clears it. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10",
          // A fade, not a hard edge. Floating over the scroller means the
          // transcript runs underneath, and without this the text simply
          // reappeared below the composer and got sliced by its top border.
          // The gradient ends opaque so nothing shows past the bottom, and
          // starts transparent so the composer still reads as floating rather
          // than as a docked bar with a border drawn back on.
          // pt-12 gives the gradient room ABOVE the composer to work in.
          // Without it the fade zone was only as tall as the composer itself,
          // so a bubble arriving from above met a hard edge instead of
          // dissolving into it.
          "pt-12",
          "bg-gradient-to-t from-[var(--bg-primary)] from-70% to-transparent",
        )}
      >
        {/* Only while the reader has scrolled away. Autoscroll deliberately
            stops when they do — being yanked back down mid-read is worse than
            missing a line — so this is the way back. */}
        {!pinned && turns.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label="Jump to latest"
            title="Jump to latest"
            className={cn(
              // pointer-events-auto: the floating wrapper disables them, and a
              // jump button that cannot be clicked is worse than none.
              "pointer-events-auto absolute -top-11 left-1/2 grid h-9 w-9 -translate-x-1/2 place-items-center",
              "rounded-full border border-[var(--border)] bg-[var(--bg-secondary)]",
              "text-[var(--text-primary)] shadow-[var(--shadow-md)] transition-colors",
              "hover:bg-[var(--bg-hover)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            )}
            style={{ zIndex: "var(--z-sticky)" }}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
        )}

        {/* Pointer events come back here. The wrapper above disables them so
            the transcript stays scrollable and selectable through the gap on
            either side of the composer; only the composer itself is clickable. */}
        <div className="pointer-events-auto mx-auto w-full max-w-[860px] px-6 py-4">
          {pending && (
            <div className="mb-3">
              <ChatPrompt
                prompt={pending}
                onApproval={(choice) => void respondApproval(choice)}
                onClarify={(answer, qid) => void respondClarify(answer, qid)}
              />
            </div>
          )}


          <div className="relative">
            <SlashPopover
              ref={popoverRef}
              input={input}
              gw={live ? gw : null}
              onApply={(next) => {
                setInput(next);
                textareaRef.current?.focus();
              }}
            />

            <div
              className={cn(
                // `hermes-composer` carries the focus treatment — see the
                // composer block in index.css for why it cannot be a utility.
                "hermes-composer rounded-2xl border bg-[var(--bg-secondary)] p-3",
                "border-[var(--border-strong)] transition-colors",
              )}
            >
              <label className="sr-only" htmlFor="chat-composer">
                Message
              </label>
              <textarea
                id="chat-composer"
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                placeholder={live ? "How can I help you today?" : "Connecting…"}
                disabled={!live}
                className={cn(
                  "max-h-[200px] min-h-[44px] w-full resize-none border-none bg-transparent",
                  // `focus-visible:outline-none` is the opt-out from the global
                  // ring; focus stays visible via the container's border.
                  "text-[var(--text-primary)] outline-none focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              />

              <div className="mt-2 flex items-center justify-between gap-3">
                {/* Left cluster: what you can add, and what will answer.
                    Both belong to the message being written, so they sit at
                    the start of the line rather than crowding the send button. */}
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <ComposerAddMenu
                    onAttach={() => fileRef.current?.click()}
                    onSlash={() => {
                      // "/" alone is what the existing SlashPopover watches
                      // for, so this hands off to the completion UI already
                      // there rather than duplicating a command list.
                      setInput((prev) => (prev.startsWith("/") ? prev : `/${prev}`));
                      textareaRef.current?.focus();
                    }}
                    disabled={!live}
                    attaching={attaching}
                  />

                  <ComposerModelButton
                    gw={gw}
                    sessionId={sessionRef.current}
                    onSubmit={(command) => void submit(command)}
                    disabled={!live}
                    onOpenModelSettings={onOpenModelSettings}
                    onModelResolved={setAskingModel}
                  />

                  <ComposerModeButton mode={mode} onChange={setMode} disabled={!live} />

                  {/* Plugins that steer the next message belong beside the
                      controls that already do — the model and the mode — not
                      in a bar of their own above the composer. Anything here
                      should pair with `registerSendTransform`; the slot is the
                      switch, the transform is the effect. */}
                  <PluginSlot name="chat:composer" />
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files?.length) void attachFiles(files);
                    // Reset so picking the same file twice fires again.
                    e.target.value = "";
                  }}
                />


                {busy ? (
                  <button
                    type="button"
                    onClick={() => void interrupt()}
                    aria-label="Stop generating"
                    title="Stop generating"
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                      "bg-[var(--bg-tertiary)] text-[var(--text-primary)] transition-colors",
                      "hover:bg-[var(--bg-hover)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    )}
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void submit(input)}
                    disabled={!live || !input.trim()}
                    aria-label="Send message"
                    title="Send message"
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                      "bg-[var(--accent)] text-[var(--bg-primary)] transition-colors",
                      "hover:bg-[var(--accent-hover)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <PluginSlot name="chat:bottom" />
          </div>
        </div>
      </div>

      <CommandPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="Resume a session"
        placeholder="Search by title"
        confirmLabel="resume"
        emptyLabel="No saved sessions yet"
        items={sessions.map((sess) => {
          const id = sess.id ?? sess.session_id ?? "";
          return {
            id,
            title: sess.title || "(untitled)",
            badge: sess.source,
            meta: sess.message_count ? `${sess.message_count} msgs` : undefined,
            group: monthGroup(sess.started_at),
            // Searchable but not shown: the id is how an operator finds a
            // session whose title is empty.
            keywords: id,
          } satisfies PanelItem;
        })}
        onSelect={(item) => void resumeSession(item.id)}
        renderDetail={(item) => {
          const sess = sessions.find((x) => (x.id ?? x.session_id) === item.id);
          return (
            <div className="flex flex-col gap-3">
              <p className="font-display text-lg font-light text-[var(--text-primary)]">
                {item.title}
              </p>
              <dl className="flex flex-col gap-1 text-sm">
                <Detail label="Session" value={item.id} />
                <Detail label="Source" value={sess?.source ?? "—"} />
                <Detail label="Messages" value={String(sess?.message_count ?? 0)} />
                <Detail
                  label="Started"
                  value={
                    sess?.started_at ? new Date(sess.started_at * 1000).toLocaleString() : "—"
                  }
                />
              </dl>
              <p className="text-xs text-[var(--text-tertiary)]">
                Resuming loads this conversation and continues it in a new live session.
              </p>
            </div>
          );
        }}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-[var(--text-secondary)]">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function EmptyState({ onPick, banner }: { onPick: (text: string) => void; banner: Banner | null }) {
  return (
    <div className="flex flex-col items-center gap-6 pt-12">
      <h2 className="font-display text-3xl font-light text-[var(--text-primary)] md:text-4xl">
        How can I help?
      </h2>

      {banner && (
        // The same line the terminal opens with, from the same source.
        <p className="text-sm text-[var(--text-secondary)]">
          {banner.toolsets} toolsets · {banner.skills} skills in {banner.categories} categories
        </p>
      )}

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.body)}
            className={cn(
              "rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-left",
              "transition-colors hover:bg-[var(--bg-hover)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            )}
          >
            <span className="block text-sm font-medium text-[var(--text-primary)]">{s.title}</span>
            <span className="mt-1 block text-sm text-[var(--text-secondary)]">{s.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A tool turn, rendered by the plugin that owns the tool when one has claimed
 * it, and by the built-in chip otherwise.
 *
 * Subscribed rather than read once: a plugin bundle is a `<script>` the host
 * injects, so it can register after this component has already mounted. Read
 * once and a page load would be a coin flip between the plugin's rendering and
 * the chip. `useSyncExternalStore` — the same primitive PluginPage uses for
 * the tab registry — is how that subscription happens without a setState in an
 * effect and the cascading render that costs.
 *
 * An error boundary is not worth a class component here, so the fallback is
 * the honest one: a renderer that throws takes down the turn, which is loud
 * and traceable, where silently swallowing it would leave a blank line the
 * reader cannot account for. The registry guarantees only that an UNCLAIMED
 * tool falls back.
 */
function PluginToolTurn({ turn }: { turn: Turn }) {
  const name = turn.toolName ?? "";
  const Renderer = useSyncExternalStore(
    onToolRendererRegistered,
    () => getToolRenderer(name),
    () => undefined,
  );

  if (Renderer) {
    return (
      <Renderer name={name} text={turn.text} output={turn.output} running={turn.running} />
    );
  }
  return <ToolTurn text={turn.text} running={turn.running} output={turn.output} />;
}

function TurnView({
  turn,
  onRetry,
  onResend,
}: {
  turn: Turn;
  onRetry?: () => void;
  /** Submits text as a new turn. Absent while the agent is busy. */
  onResend?: (text: string) => void;
}) {
  if (turn.role === "user") {
    return (
      // `group` is what the action row's hover reveal keys off. On the <li>,
      // not the bubble: the icons sit outside the bubble, so a bubble-scoped
      // group would hide them the instant the pointer moved toward them.
      <li className="group flex flex-col items-end">
        <div className="max-w-[80%] rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-[var(--text-primary)]">
          <p className="whitespace-pre-wrap break-words">{turn.text}</p>
        </div>
        <UserMessageActions text={turn.text} onResend={onResend} />
      </li>
    );
  }

  if (turn.role === "tool") {
    return (
      <li>
        <PluginToolTurn turn={turn} />
      </li>
    );
  }

  if (turn.role === "system") {
    return (
      <li>
        <p className="whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">
          {turn.text}
        </p>
      </li>
    );
  }

  return (
    <li className="group">
      {/* Which model is speaking, above the words it said. It used to sit in
          the usage line underneath, where you learned the author only after
          reading the whole reply — and not at all until usage arrived, which
          is after the stream ends. A combo makes this load-bearing: the whole
          point of `combo/free-first` is that the answer may come from any link
          in the chain, and "who answered" is then part of the answer. */}
      {turn.usage?.model && (
        <p className="mb-1 font-mono-ui text-xs text-[var(--text-tertiary)]">
          {turn.usage.model}
        </p>
      )}

      {/* The bubble wraps the reply and nothing else. The model name stays
          outside it, above — it labels the speaker, and putting a label inside
          the speech makes it read as part of what was said. */}
      <div
        className={cn(
          "rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]",
          "px-3 py-2",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-[var(--text-primary)]">
          {turn.text}
          {turn.streaming && (
            <Loader2
              className="ml-1 inline h-3.5 w-3.5 animate-spin align-baseline text-[var(--text-secondary)]"
              aria-label="Generating"
            />
          )}
        </p>
      </div>

      {turn.usage && (
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          {[
            turn.usage.total != null ? `${turn.usage.total.toLocaleString()} tokens` : null,
            turn.usage.context_percent != null ? `${turn.usage.context_percent}% context` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {/* Hidden mid-stream: copying or rating half a sentence is meaningless,
          and a Retry that fires while the model is still writing races it. */}
      {!turn.streaming && turn.text.trim() !== "" && (
        <MessageActions text={turn.text} onRetry={onRetry} />
      )}
    </li>
  );
}
