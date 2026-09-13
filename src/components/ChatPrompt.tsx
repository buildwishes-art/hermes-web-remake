/**
 * The two blocking prompts an agent turn can raise: a permission request
 * before a side-effectful command, and a clarifying question.
 *
 * Both hold the turn open server-side until answered, which is why they get a
 * card in the transcript rather than a toast — a toast that scrolls away
 * leaves the agent waiting with nothing on screen explaining why.
 *
 * Wire contracts, read off tui_gateway rather than guessed:
 *
 *   approval.request  { request_id, choices: string[], command?, … }
 *   approval.respond  { session_id, request_id, choice }
 *
 *   clarify.request   single: { request_id, question, choices, multi_select? }
 *                     batch:  { request_id, questions: [{ qid, question, choices,
 *                               multi_select }], answers? }
 *   clarify.respond   single: { session_id, request_id, answer }
 *                     batch:  { session_id, request_id, question_id, answer }
 *
 * The batch form unblocks only once every `qid` has been answered, so each
 * question is submitted on its own and the card stays until the last one.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ApprovalPrompt {
  kind: "approval";
  requestId: string;
  /** Server-computed and authoritative — never hardcode the option list.
   *  A smart-denied command offers only ["once", "deny"]. */
  choices: string[];
  command?: string;
}

export interface ClarifyQuestion {
  qid?: string;
  question: string;
  choices?: string[];
  multiSelect?: boolean;
}

export interface ClarifyPrompt {
  kind: "clarify";
  requestId: string;
  questions: ClarifyQuestion[];
  /** qids already locked in — replayed by the server after a reconnect. */
  answered: Record<string, string>;
}

export type PendingPrompt = ApprovalPrompt | ClarifyPrompt;

interface Props {
  prompt: PendingPrompt;
  /** Approval choice, or a clarify answer for one question. */
  onApproval(choice: string): void;
  onClarify(answer: string, qid?: string): void;
}

/** Deny is the one choice that must never be reachable by accident. */
const isDeny = (choice: string) => choice === "deny";

const CHOICE_LABEL: Record<string, string> = {
  once: "Allow once",
  session: "Allow this session",
  always: "Always allow",
  deny: "Deny",
};

export function ChatPrompt({ prompt, onApproval, onClarify }: Props) {
  return (
    <div
      role="group"
      aria-label={prompt.kind === "approval" ? "Permission request" : "Question from the agent"}
      className={cn(
        "rounded-lg border bg-[var(--bg-secondary)] p-3",
        // A blocking prompt is the one thing on screen that needs the
        // operator now, so it gets the accent boundary rather than the quiet
        // decorative one every other card uses.
        "border-[var(--accent)]",
      )}
    >
      {prompt.kind === "approval" ? (
        <ApprovalBody prompt={prompt} onApproval={onApproval} />
      ) : (
        <ClarifyBody prompt={prompt} onClarify={onClarify} />
      )}
    </div>
  );
}

function ApprovalBody({
  prompt,
  onApproval,
}: {
  prompt: ApprovalPrompt;
  onApproval: (choice: string) => void;
}) {
  return (
    <>
      <p className="text-sm font-medium text-[var(--text-primary)]">
        The agent wants to run a command
      </p>

      {prompt.command && (
        // Already redacted server-side (_redact_approval_command) — the raw
        // string can contain credential-shaped values.
        <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--bg-tertiary)] p-2 text-xs text-[var(--text-primary)]">
          <code>{prompt.command}</code>
        </pre>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {prompt.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => onApproval(choice)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              isDeny(choice)
                ? "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                : choice === "once"
                  ? "bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)]"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
            )}
          >
            {CHOICE_LABEL[choice] ?? choice}
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        The turn stays paused until you choose.
      </p>
    </>
  );
}

function ClarifyBody({
  prompt,
  onClarify,
}: {
  prompt: ClarifyPrompt;
  onClarify: (answer: string, qid?: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {prompt.questions.map((q, i) => (
        <ClarifyQuestionView
          key={q.qid ?? `q${i}`}
          question={q}
          answered={q.qid ? prompt.answered[q.qid] : undefined}
          onAnswer={(answer) => onClarify(answer, q.qid)}
        />
      ))}
    </div>
  );
}

function ClarifyQuestionView({
  question,
  answered,
  onAnswer,
}: {
  question: ClarifyQuestion;
  answered?: string;
  onAnswer: (answer: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const choices = question.choices ?? [];
  const locked = answered !== undefined;

  if (locked) {
    return (
      <div>
        <p className="text-sm text-[var(--text-secondary)]">{question.question}</p>
        <p className="mt-1 text-sm text-[var(--text-primary)]">✓ {answered}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-[var(--text-primary)]">{question.question}</p>

      {choices.length > 0 ? (
        question.multiSelect ? (
          <>
            <div className="mt-2 flex flex-col gap-1">
              {choices.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={picked.includes(c)}
                    onChange={(e) =>
                      setPicked((prev) =>
                        e.target.checked ? [...prev, c] : prev.filter((p) => p !== c),
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => onAnswer(picked.join(", "))}
              className={cn(
                "mt-2 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--bg-primary)]",
                "transition-colors hover:bg-[var(--accent-hover)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              Confirm
            </button>
          </>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {choices.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onAnswer(c)}
                className={cn(
                  "rounded-md bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)]",
                  "transition-colors hover:bg-[var(--bg-hover)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )
      ) : (
        // No choices offered: the agent wants prose back.
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (freeText.trim()) onAnswer(freeText.trim());
          }}
        >
          <input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            aria-label={question.question}
            className={cn(
              "min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-tertiary)]",
              "px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none",
              "focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            )}
          />
          <button
            type="submit"
            disabled={!freeText.trim()}
            className={cn(
              "rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--bg-primary)]",
              "transition-colors hover:bg-[var(--accent-hover)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            Answer
          </button>
        </form>
      )}
    </div>
  );
}
