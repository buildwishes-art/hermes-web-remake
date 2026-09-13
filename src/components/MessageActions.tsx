import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RotateCw, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";

/**
 * The action row under an assistant reply: copy, read aloud, rate, retry.
 *
 * Rating is LOCAL ONLY. There is no feedback endpoint on the Hermes backend —
 * nothing to POST a thumbs to — so a rating is stored in `localStorage` and
 * never leaves this browser. It is a bookmark for the reader, not telemetry,
 * and it is labelled that way in the tooltip so nobody assumes it trains
 * anything. Wire it to a real endpoint and this component keeps its shape.
 *
 * Keyed by a hash of the reply text rather than the turn id: ids are minted
 * per session (`nextTurnId()`), so an id-keyed rating would be orphaned by the
 * next reload while the text it belongs to is still on screen.
 */

type Rating = "up" | "down" | null;

/** djb2 — small, stable, and enough to key a note-to-self by. */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const RATING_PREFIX = "hermes.rating.";

function readRating(key: string): Rating {
  try {
    const v = localStorage.getItem(RATING_PREFIX + key);
    return v === "up" || v === "down" ? v : null;
  } catch {
    // Private windows and blocked site-data throw on access, not on read of a
    // missing key. An unratable message is fine; a crashed transcript is not.
    return null;
  }
}

function writeRating(key: string, value: Rating): void {
  try {
    if (value === null) localStorage.removeItem(RATING_PREFIX + key);
    else localStorage.setItem(RATING_PREFIX + key, value);
  } catch {
    /* see readRating */
  }
}

function ActionButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)]",
        "text-[var(--text-tertiary)] transition-colors",
        "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        active && "text-[var(--accent)]",
      )}
    >
      {children}
    </button>
  );
}

export function MessageActions({
  text,
  onRetry,
}: {
  text: string;
  /** Omitted when there is no user turn to replay — the row then hides Retry. */
  onRetry?: () => void;
}) {
  const key = hashText(text);
  const [rating, setRating] = useState<Rating>(() => readRating(key));
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // A rating belongs to the text, so re-read when the text changes under us
  // (streaming finishes, a resumed transcript swaps turns in).
  useEffect(() => setRating(readRating(key)), [key]);

  // Stop narration if this reply leaves the screen. Without it the voice keeps
  // reading a message the reader has already navigated away from.
  useEffect(() => () => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* unsupported */
    }
  }, []);

  const copy = useCallback(() => {
    // Shared helper: it falls back to a selection-based copy outside a secure
    // context, where navigator.clipboard rejects. Writing to the API directly
    // is what made this button fail silently on first pass.
    void copyTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  const speak = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (synth.speaking || speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utter);
  }, [text, speaking]);

  const rate = useCallback(
    (next: Exclude<Rating, null>) => {
      // Clicking the active thumb clears it — a rating you cannot take back is
      // a rating people stop giving.
      const value = rating === next ? null : next;
      setRating(value);
      writeRating(key, value);
    },
    [rating, key],
  );

  const ttsAvailable = typeof window !== "undefined" && !!window.speechSynthesis;

  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-0.5 transition-opacity",
        // Hidden until the reader comes near the message, so a long transcript
        // is text rather than rows of buttons. Driven by the turn's `group`.
        "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        // But never hidden mid-action: fading out while the voice is still
        // reading takes the stop button with it, and swallowing the "Copied"
        // tick leaves the click looking like it did nothing.
        (speaking || copied) && "opacity-100",
      )}
      role="group"
      aria-label="Reply actions"
    >
      <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </ActionButton>

      {ttsAvailable && (
        <ActionButton label={speaking ? "Stop reading" : "Read aloud"} active={speaking} onClick={speak}>
          {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </ActionButton>
      )}

      <ActionButton
        label="Good response (saved in this browser only)"
        active={rating === "up"}
        onClick={() => rate("up")}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </ActionButton>

      <ActionButton
        label="Bad response (saved in this browser only)"
        active={rating === "down"}
        onClick={() => rate("down")}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </ActionButton>

      {onRetry && (
        <ActionButton label="Retry" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" />
        </ActionButton>
      )}
    </div>
  );
}
