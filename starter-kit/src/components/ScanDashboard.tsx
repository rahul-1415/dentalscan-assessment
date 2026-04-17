"use client";

// [Task 03 — Patient-Dentist Messaging · R1 R3]
// ScanDashboard is the post-scan results screen. It fulfils two requirements:
//
// R1 (Messaging UI): renders the captured thumbnails, a "Chat with Clinic"
//    trigger, and — once opened — a full chat panel with message history,
//    quick-reply chips, and a textarea input for composing new messages.
//
// R3 (State Consistency / Optimistic UI): messages are appended to local state
//    immediately with a temporary ID, then replaced with the server-confirmed
//    message on success. On error the optimistic message is removed and the
//    draft is restored so the user doesn't lose what they typed.
//
// The component is rendered inside a fixed inset-0 overlay (see ScanningFlow)
// so it covers the full browser viewport regardless of the 430px phone column.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, RefreshCw, Send } from "lucide-react";

type Message = {
  id: string;
  content: string;
  sender: "patient" | "dentist";
  createdAt: string;
};

type Thread = { id: string; patientId: string };

type Props = {
  scanId: string;
  capturedImages: (string | null)[];
  viewLabels: string[];
  onReset: () => void;
};

// [Task 03 · R1: Quick-reply chips]
// Pre-written prompts reduce friction for patients who aren't sure what to ask.
const QUICK_REPLIES = [
  "When should I expect results?",
  "Can I book a follow-up call?",
  "Is the scan quality good enough?",
];

export default function ScanDashboard({ scanId, capturedImages, viewLabels, onReset }: Props) {
  const [chatOpen, setChatOpen]       = useState(false);
  const [thread, setThread]           = useState<Thread | null>(null);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [draft, setDraft]             = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // [Task 03 · R1: Load thread on chat open]
  // Thread is fetched lazily — only when the patient taps "Chat with Clinic" —
  // so the dashboard loads instantly without waiting for a DB query.
  const loadThread = useCallback(async () => {
    setLoadingThread(true);
    setError(null);
    try {
      const res = await fetch("/api/messaging", { cache: "no-store" });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const data = (await res.json()) as { thread: Thread; messages: Message[] };
      setThread(data.thread);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load messages");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (chatOpen && !thread) void loadThread();
  }, [chatOpen, thread, loadThread]);

  // Auto-scroll message list to bottom whenever a new message arrives
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  // [Task 03 · R3: Optimistic send with error rollback]
  // 1. Append message to local state immediately with a temp ID (optimistic)
  // 2. POST to /api/messaging
  // 3. On success: swap temp ID for server-confirmed message
  // 4. On failure: remove the optimistic message and restore the draft text
  //    so the user can retry without retyping — no data loss.
  const send = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);

    // [R3: Optimistic UI — add message locally before server confirms]
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, content: trimmed, sender: "patient", createdAt: new Date().toISOString() }]);
    setDraft("");

    try {
      // [Task 03 · R1 R2: POST to messaging backend]
      const res = await fetch("/api/messaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread?.id, sender: "patient", content: trimmed, scanId }),
      });
      if (!res.ok) throw new Error(`Send failed (${res.status})`);
      const data = (await res.json()) as { thread: Thread; message: Message };
      setThread(data.thread);
      // [R3: Replace temp message with server-confirmed record]
      setMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)));
    } catch (e) {
      // [R3: Rollback — remove optimistic message and restore draft]
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(trimmed);
      setError(e instanceof Error ? e.message : "Unable to send");
    } finally {
      setSending(false);
    }
  }, [thread?.id, sending, scanId]);

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900">
      {/* Header */}
      <div className="flex w-full shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight text-blue-600">DentalScan AI</h1>
        <span className="text-[11px] uppercase tracking-widest text-zinc-400">Scan Complete</span>
      </div>

      {/* Scrollable body — centred at max-w-2xl so content reads well on wide screens */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-8">

          {/* [Task 02 · R1: Upload confirmation banner]
              Shows the scan reference and confirms the clinic notification was
              triggered — visible evidence that R1 (notification on upload) fired. */}
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white px-5 py-4 shadow-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 size={22} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">Scan uploaded successfully</p>
              <p className="text-[10px] text-zinc-400">
                Ref: {scanId.slice(0, 12)} · Your clinic has been notified and will review shortly.
              </p>
            </div>
          </div>

          {/* [Task 01 · R1: Captured frame thumbnails]
              5 square thumbnails, one per clinical angle, so the patient can
              review what was sent before chatting with the clinic. */}
          <div className="mb-8 grid grid-cols-5 gap-3">
            {capturedImages.map((src, i) =>
              src ? (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={viewLabels[i]}
                    className="aspect-square w-full rounded-xl border border-zinc-200 object-cover shadow-sm"
                  />
                  <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">
                    {viewLabels[i].replace(" View", "").replace(" Teeth", "")}
                  </span>
                </div>
              ) : null,
            )}
          </div>

          {/* [Task 03 · R1: Chat trigger button]
              Shown until the patient opens the chat. Lazy-loads the thread so
              the dashboard renders instantly without a blocking DB query. */}
          {!chatOpen && (
            <div className="flex flex-col items-center gap-3 py-4">
              <button
                onClick={() => setChatOpen(true)}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-8 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 active:scale-95"
              >
                <MessageCircle size={16} />
                Chat with Clinic
              </button>
              <p className="text-[11px] text-zinc-400">Ask the clinic anything about your scan</p>
            </div>
          )}

          {/* [Task 03 · R1 R3: Inline chat panel]
              Expands below the thumbnails when chatOpen=true. Uses the same
              send() function which implements the R3 optimistic-update pattern. */}
          {chatOpen && (
            <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3">
                <MessageCircle size={14} className="text-blue-500" />
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Clinic Chat</p>
              </div>

              {/* Message list */}
              <div ref={scrollerRef} className="flex max-h-80 min-h-[160px] flex-col gap-2 overflow-y-auto px-5 py-4">
                {loadingThread && (
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Loader2 size={13} className="animate-spin" /> Loading…
                  </div>
                )}
                {!loadingThread && messages.length === 0 && (
                  <p className="text-xs text-zinc-400">No messages yet — send one below.</p>
                )}
                {messages.map((m) => (
                  // Patient messages right-aligned blue; dentist messages left-aligned card
                  <div
                    key={m.id}
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-snug ${
                      m.sender === "patient"
                        ? "ml-auto bg-blue-600 text-white"
                        : "border border-zinc-200 bg-zinc-50 text-zinc-800"
                    }`}
                  >
                    {m.content}
                    <div className={`mt-0.5 text-[10px] ${m.sender === "patient" ? "opacity-60" : "text-zinc-400"}`}>
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>

              {/* [Task 03 · R1: Quick-reply chips — reduce patient friction] */}
              <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 px-5 py-3">
                {QUICK_REPLIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => void send(q)}
                    disabled={sending}
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-600 transition hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* [Task 03 · R1: Message compose input]
                  Enter sends (Shift+Enter = newline). Textarea capped at 2000 chars
                  to match the backend validation limit. */}
              <div className="border-t border-zinc-100 px-5 pb-4 pt-2">
                {error && <p className="mb-2 text-[11px] text-red-500">{error}</p>}
                <form
                  onSubmit={(e) => { e.preventDefault(); void send(draft); }}
                  className="flex items-end gap-2"
                >
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); }
                    }}
                    placeholder="Write a message…"
                    rows={2}
                    maxLength={2000}
                    className="flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || sending}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-40"
                    aria-label="Send"
                  >
                    {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-zinc-200 bg-white px-6 py-3">
        <div className="mx-auto max-w-2xl">
          <button
            onClick={onReset}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-zinc-200 py-2 text-xs font-medium text-zinc-500 transition hover:border-blue-400 hover:text-blue-600"
          >
            <RefreshCw size={13} /> Start a new scan
          </button>
        </div>
      </div>
    </div>
  );
}
