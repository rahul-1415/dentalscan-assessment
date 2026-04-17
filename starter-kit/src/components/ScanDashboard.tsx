"use client";

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

const QUICK_REPLIES = [
  "When should I expect results?",
  "Can I book a follow-up call?",
  "Is the scan quality good enough?",
];

export default function ScanDashboard({
  scanId,
  capturedImages,
  viewLabels,
  onReset,
}: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingThread, setLoadingThread] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setError(null);

      const tempId = `tmp-${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        content: trimmed,
        sender: "patient",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setDraft("");

      try {
        const res = await fetch("/api/messaging", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: thread?.id,
            sender: "patient",
            content: trimmed,
            scanId,
          }),
        });
        if (!res.ok) throw new Error(`Send failed (${res.status})`);
        const data = (await res.json()) as { thread: Thread; message: Message };
        setThread(data.thread);
        setMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)));
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft(trimmed);
        setError(e instanceof Error ? e.message : "Unable to send");
      } finally {
        setSending(false);
      }
    },
    [thread?.id, sending, scanId],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Scan summary */}
      <div className="shrink-0 px-5 pt-5 pb-3">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle2 size={20} className="text-emerald-400" />
          <div>
            <p className="text-sm font-semibold">Scan uploaded</p>
            <p className="text-[10px] text-zinc-500">Ref: {scanId.slice(0, 12)}</p>
          </div>
        </div>

        {/* Image grid */}
        <div className="grid grid-cols-5 gap-1.5">
          {capturedImages.map((src, i) =>
            src ? (
              <div key={i} className="flex flex-col items-center gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={viewLabels[i]}
                  className="h-14 w-full rounded-md object-cover"
                />
                <span className="text-[8px] uppercase tracking-wide text-zinc-500">
                  {viewLabels[i]
                    .replace(" View", "")
                    .replace(" Teeth", "")}
                </span>
              </div>
            ) : null,
          )}
        </div>

        <p className="mt-3 text-[11px] text-zinc-400">
          Your clinic has been notified and will review your scan shortly.
        </p>
      </div>

      <div className="mx-5 shrink-0 border-t border-zinc-800" />

      {/* Chat trigger */}
      {!chatOpen && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5">
          <button
            onClick={() => setChatOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-900/30 transition hover:bg-blue-500 active:scale-95"
          >
            <MessageCircle size={16} />
            Chat with Clinic
          </button>
          <p className="text-[11px] text-zinc-500">
            Ask the clinic anything about your scan
          </p>
        </div>
      )}

      {/* Messaging — fills remaining space once opened */}
      {chatOpen && <div className="flex min-h-0 flex-1 flex-col">
        <p className="shrink-0 px-5 py-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          Clinic chat
        </p>

        {/* Message list */}
        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 space-y-2"
        >
          {loadingThread && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          )}
          {!loadingThread && messages.length === 0 && (
            <p className="text-xs text-zinc-500">
              No messages yet — ask the clinic anything below.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${
                m.sender === "patient"
                  ? "ml-auto bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-100"
              }`}
            >
              {m.content}
              <div className="mt-0.5 text-[10px] opacity-50">
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Quick replies + input */}
        <div className="shrink-0 border-t border-zinc-800 px-4 pt-2 pb-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                disabled={sending}
                className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-500 hover:text-white disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>

          {error && <p className="mb-1.5 text-[11px] text-red-400">{error}</p>}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="Write a message…"
              rows={2}
              maxLength={2000}
              className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
              aria-label="Send"
            >
              {sending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
            </button>
          </form>
        </div>
      </div>}

      {/* New scan CTA */}
      <div className="shrink-0 border-t border-zinc-800 px-5 py-3">
        <button
          onClick={onReset}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-zinc-700 py-2 text-xs text-zinc-300 hover:border-blue-500 hover:text-white"
        >
          <RefreshCw size={13} /> Start a new scan
        </button>
      </div>
    </div>
  );
}
