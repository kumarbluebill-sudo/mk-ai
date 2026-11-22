"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, FileText, Map as MapIcon, Plus, Sparkles, Square, TriangleAlert } from "lucide-react";
import { ViatorActivitySearch } from "@/components/viator-activity-search";
import type { Itinerary } from "@/server/travel/itinerary";

type Role = "USER" | "ASSISTANT" | "SYSTEM";

interface Message {
  id: string;
  role: Role;
  content: string;
}

interface ConversationSummary {
  id: string;
  title: string;
}

type StreamEvent =
  | { type: "conversation"; id: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "message"; content: string; mode: "ai" | "scripted-fallback"; itinerary: Itinerary | null }
  | { type: "error"; message: string }
  | { type: "done" };

const TOOL_LABELS: Record<string, string> = {
  extract_travel_requirements: "Noting your trip details",
  search_destinations: "Searching destinations",
  search_activities: "Searching live activities",
  get_product_details: "Reading product details",
  check_availability: "Checking live availability",
  calculate_package_price: "Calculating price",
  create_itinerary: "Building your itinerary",
  modify_itinerary: "Updating your itinerary",
  create_quotation: "Preparing a draft quotation",
};

const STATUS_CLASS: Record<string, string> = {
  LIVE: "bg-emerald-100 text-emerald-800",
  ESTIMATE: "bg-amber-100 text-amber-800",
  UNVERIFIED: "bg-gray-200 text-gray-700",
};

const SUGGESTIONS = [
  "5 days in Dubai for 2 adults and 1 child",
  "Bali honeymoon, 6 nights, mid-range budget",
  "Weekend in Jaipur for a family of 4",
  "Kyoto in cherry blossom season for 2",
];

export function ChatInterface({ embedded = false, initialMessage, initialConversationId }: { embedded?: boolean; initialMessage?: string; initialConversationId?: string } = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [progress, setProgress] = useState("");
  const [fallbackMode, setFallbackMode] = useState(false);
  const [activityQuery, setActivityQuery] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [sendError, setSendError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, progress]);

  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialMessage || sentInitial.current) return;
    sentInitial.current = true;
    void submit(initialMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      const data = (await res.json()) as { conversations?: ConversationSummary[] };
      if (res.ok && Array.isArray(data.conversations)) setConversations(data.conversations);
    } catch {
      // The sidebar is optional; chat still works without it.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void loadConversations();
  }, [loadConversations]);

  const openConversation = useCallback(async (id: string) => {
    setHistoryError("");
    try {
      const res = await fetch(`/api/chat?id=${encodeURIComponent(id)}`);
      const data = (await res.json()) as { messages?: Message[]; itinerary?: Itinerary | null; error?: string };
      if (!res.ok || !Array.isArray(data.messages)) throw new Error(data.error || "Failed to load conversation");
      setConversationId(id);
      setMessages(data.messages);
      setItinerary(data.itinerary ?? null);
      setActivityQuery("");
    } catch (error) {
      console.error("Failed to load chat history:", error);
      setHistoryError("Saved chat history is unavailable. Live activity search is still available.");
    }
  }, []);

  const openedInitial = useRef(false);
  useEffect(() => {
    if (!initialConversationId || openedInitial.current) return;
    openedInitial.current = true;
    void openConversation(initialConversationId);
  }, [initialConversationId, openConversation]);

  const newChat = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setItinerary(null);
    setActivityQuery("");
    setSendError("");
    setHistoryError("");
    setProgress("");
  };

  const stop = () => abortRef.current?.abort();

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(input);
  };

  const submit = async (text: string) => {
    const userMessage = text.trim();
    if (!userMessage || loading) return;

    setInput("");
    setLoading(true);
    setSendError("");
    setProgress("Thinking");
    setActivityQuery(
      /\b(price|cost|rate|activity|activities|tour|destination|trip|travel|plan|search|visit|things to do|bali|dubai|kyoto|paris|tokyo|thailand|maldives|jaipur)\b/i.test(
        userMessage
      )
        ? userMessage
        : ""
    );
    setMessages((prev) => [...prev, { id: `temp-user-${Date.now()}`, role: "USER", content: userMessage }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId ?? undefined, message: userMessage }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        // Stale or missing session (e.g. the database changed): send the user to sign in again.
        window.location.assign("/login?next=/");
        throw new Error("Your session has expired. Redirecting to sign in…");
      }

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(data.message || data.error || "Chat request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as StreamEvent;
          if (event.type === "conversation") setConversationId(event.id);
          else if (event.type === "tool_start") setProgress(TOOL_LABELS[event.name] ?? "Working");
          else if (event.type === "tool_result") setProgress("Thinking");
          else if (event.type === "message") {
            setFallbackMode(event.mode === "scripted-fallback");
            setItinerary(event.itinerary);
            setMessages((prev) => [...prev, { id: `ai-${Date.now()}`, role: "ASSISTANT", content: event.content }]);
          } else if (event.type === "error") streamError = event.message;
        }
      }
      if (streamError) throw new Error(streamError);
      void loadConversations();
    } catch (error) {
      if (controller.signal.aborted) {
        setSendError("Stopped. Anything already saved remains in this conversation.");
      } else {
        console.error("Failed to send message:", error);
        setSendError(
          error instanceof Error && error.message
            ? error.message
            : "Chat could not finish this message; it may not have been saved."
        );
      }
    } finally {
      setLoading(false);
      setProgress("");
      abortRef.current = null;
    }
  };

  const send = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  return (
    <div className={`flex w-full bg-[#f6f7f5] ${embedded ? "h-[calc(100dvh-60px)]" : "h-[calc(100dvh-3.5rem)]"}`}>
      <aside className={`${embedded ? "hidden" : "hidden md:flex"} w-64 shrink-0 flex-col gap-3 border-r border-gray-200 bg-white p-3`} aria-label="Conversations">
        <button
          type="button"
          onClick={newChat}
          className="flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800"
        >
          <Plus size={16} /> New chat
        </button>
        <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Recent</p>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void openConversation(c.id)}
              className={`truncate rounded-lg px-3 py-2 text-left text-sm transition ${
                c.id === conversationId ? "bg-brand-50 font-medium text-brand-800" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {c.title}
            </button>
          ))}
          {conversations.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No conversations yet</p>}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-5 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-800 text-white"><Bot size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-900">MK AI Travel Agent</h2>
            <p className="truncate text-xs text-gray-500">Tell me the place, dates and travellers. I search live supplier inventory and build the quotation.</p>
          </div>
          <button type="button" onClick={newChat} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 md:hidden">
            New chat
          </button>
        </div>

        {fallbackMode && (
          <p role="status" className="flex items-center gap-2 bg-amber-50 px-5 py-2 text-xs text-amber-800">
            <TriangleAlert size={14} className="shrink-0" />
            The AI planner is not configured on this server. Replies are basic scripted guidance, not live search or pricing.
          </p>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
            {historyError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {historyError}
              </p>
            )}
            {messages.length === 0 && (
              <div className="mk-fade flex flex-col items-center gap-3 pt-10 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-100 text-brand-700"><Sparkles size={26} /></span>
                <h3 className="font-serif text-3xl text-gray-900">Where would you like to send your client?</h3>
                <p className="max-w-md text-sm text-gray-500">
                  Tell me the place, travel date and number of persons. I&apos;ll check live availability, build the itinerary with rates, and prepare a quotation.
                </p>
                <div className="mt-4 grid w-full gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => send(q)}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) =>
              msg.role === "USER" ? (
                <div key={msg.id} className="mk-fade flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-sm leading-relaxed text-white">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="mk-fade flex items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700"><Bot size={16} /></span>
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-gray-200 bg-white px-4 py-2.5 text-sm leading-relaxed text-gray-800 shadow-sm">
                    {msg.content}
                  </div>
                </div>
              )
            )}

            {loading && (
              <div role="status" className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700"><Bot size={16} /></span>
                <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-500 shadow-sm">
                  <span className="mk-typing" aria-hidden="true"><span /><span /><span /></span>
                  {progress ? `${progress}…` : "Thinking…"}
                </div>
              </div>
            )}

            {itinerary && conversationId && (
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/designer/${conversationId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
                >
                  <MapIcon size={15} /> Open in the itinerary designer (edit, reorder, map)
                </Link>
                <Link
                  href={`/designer/${conversationId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <FileText size={15} /> Quotation
                </Link>
              </div>
            )}
            {itinerary && <ItineraryCards itinerary={itinerary} />}

            {sendError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {sendError}
              </p>
            )}
            {activityQuery && <ViatorActivitySearch key={activityQuery} query={activityQuery} />}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form onSubmit={sendMessage} className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-gray-300 bg-white py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Dubai, 12 Dec, 2 adults 1 child"
              maxLength={4000}
              disabled={loading}
              className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm shadow-none outline-none focus:shadow-none focus:ring-0"
              aria-label="Message"
            />
            {loading ? (
              <button type="button" onClick={stop} aria-label="Stop" className="grid h-9 w-9 place-items-center rounded-xl bg-gray-600 text-white hover:bg-gray-700">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send"
                className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white transition hover:bg-brand-800 disabled:opacity-40"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function ItineraryCards({ itinerary }: { itinerary: Itinerary }) {
  return (
    <section aria-label="Itinerary" className="mk-card mk-fade p-5">
      <h3 className="font-serif text-2xl text-gray-900">{itinerary.title}</h3>
      <p className="mb-4 mt-1 text-xs text-gray-500">
        Items are marked LIVE only when confirmed by a supplier availability check. Nothing here is booked.
      </p>
      <div className="space-y-4">
        {itinerary.days.map((day) => (
          <div key={day.dayNumber} className="flex gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-xs font-bold text-brand-800">
              D{day.dayNumber}
            </div>
            <div className="min-w-0 flex-1 border-b border-gray-100 pb-4 last:border-0">
              <p className="text-sm font-semibold text-gray-900">
                {day.title}
                {day.date ? <span className="ml-2 font-normal text-gray-400">{day.date}</span> : null}
              </p>
              <ul className="mt-2 space-y-1.5">
                {day.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-2 text-sm text-gray-700">
                    {item.startTime && <span className="text-gray-400">{item.startTime}</span>}
                    <span>{item.title}</span>
                    {item.price !== undefined && item.currency ? (
                      <span className="font-medium text-gray-900">
                        {item.currency} {item.price}
                      </span>
                    ) : null}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CLASS[item.status] ?? STATUS_CLASS.UNVERIFIED}`}>
                      {item.status}
                    </span>
                  </li>
                ))}
                {day.items.length === 0 && <li className="text-sm text-gray-400">Nothing planned yet</li>}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
