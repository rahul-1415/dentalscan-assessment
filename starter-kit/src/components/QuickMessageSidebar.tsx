"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send, MessageCircle, X, Loader2 } from "lucide-react";

type Message = {
  id: string;
  content: string;
  sender: "patient" | "dentist";
  createdAt: string;
};

type Thread = { id: string; patientId: string };

type Props = {
  scanId?: string | null;
  patientId?: string;
  defaultOpen?: boolean;
};

const QUICK_REPLIES = [
  "When should I expect results?",
  "Can I book a follow-up call?",
  "Is the scan quality good enough?",
];

export default function QuickMessageSidebar({
  scanId,
  patientId,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const loadThread = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = patientId ? `?patientId=${encodeURIComponent(patientId)}` : "";
      const res = await fetch(`/api/messaging${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const data = (await res.json()) as { thread: Thread; messages: Message[] };
      setThread(data.thread);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load messages");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (open && !thread) void loadThread();
  }, [open, thread, loadThread]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setError(null);

      // Optimistic insert — the server id replaces the temp id on success.
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
            patientId,
            sender: "patient",
            content: trimmed,
            scanId,
          }),
        });
        if (!res.ok) throw new Error(`Send failed (${res.status})`);
        const data = (await res.json()) as { thread: Thread; message: Message };
        setThread(data.thread);
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? data.message : m)),
        );
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft(trimmed);
        setError(e instanceof Error ? e.message : "Unable to send");
      } finally {
        setSending(false);
      }
    },
    [thread?.id, patientId, sending, scanId],
  );

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-blue-900/40 hover:bg-blue-500 active:scale-95 transition"
          aria-label="Open messaging"
        >
          <MessageCircle size={18} />
          Message your clinic
        </button>
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-sm transform border-l border-zinc-800 bg-zinc-950 text-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Clinic chat</h2>
            <p className="text-[11px] text-zinc-500">
              {scanId ? `Scan ${scanId.slice(0, 8)}` : "General inquiry"}
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white"
            aria-label="Close messaging"
          >
            <X size={16} />
          </button>
        </header>

        <div
          ref={scrollerRef}
          className="h-[calc(100%-13rem)] overflow-y-auto px-5 py-4 space-y-3"
        >
          {loading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading conversation…
            </div>
          )}
          {!loading && messages.length === 0 && (
            <p className="text-xs text-zinc-500">
              No messages yet. Say hi — the clinic will reply after reviewing your scan.
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
              <div className="mt-1 text-[10px] opacity-60">
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-800 px-5 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={sending}
                className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-blue-500 hover:text-white disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>

          {error && (
            <p className="mb-2 text-[11px] text-red-400">{error}</p>
          )}

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
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
        </div>
      </aside>

      {open && (
        <button
          aria-label="Close messaging overlay"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
