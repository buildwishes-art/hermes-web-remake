/**
 * The message-UI chat surface — the one the sidebar calls "Chat".
 *
 * It talks to the tui_gateway JSON-RPC socket directly. The xterm surface at
 * /chat still exists for anyone who deep-links it, but it no longer has a
 * sidebar entry, so every hand-off from elsewhere in the dashboard lands here.
 *
 * This page owns the URL reading; ChatTranscript stays router-free.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { ChatTranscript } from "@/components/ChatTranscript";

export default function ChatWebPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  /**
   * Captured at mount, before the effect below strips them. Without the strip,
   * a refresh would resume a second time — and every resume mints a new live
   * session id, so that leaves litter behind.
   */
  const [arrival] = useState(() => ({
    resume: searchParams.get("resume"),
    learn: searchParams.get("learn"),
  }));

  useEffect(() => {
    if (!arrival.resume && !arrival.learn) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("resume");
        next.delete("learn");
        return next;
      },
      { replace: true },
    );
  }, [arrival.resume, arrival.learn, setSearchParams]);

  return (
    <ChatTranscript
      resumeSessionId={arrival.resume}
      initialInput={arrival.learn}
      onOpenModelSettings={() => navigate("/models")}
    />
  );
}
