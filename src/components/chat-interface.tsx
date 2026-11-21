"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  LIVE: { bg: "#dcfce7", fg: "#166534" },
  ESTIMATE: { bg: "#fef9c3", fg: "#854d0e" },
  UNVERIFIED: { bg: "#e5e7eb", fg: "#374151" },
};

export function ChatInterface() {
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, progress]);

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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const userMessage = input.trim();
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

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar} aria-label="Conversations">
        <button type="button" onClick={newChat} style={styles.newChat}>
          + New chat
        </button>
        <div style={styles.sidebarList}>
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void openConversation(c.id)}
              style={{ ...styles.sidebarItem, backgroundColor: c.id === conversationId ? "#dbeafe" : "transparent" }}
            >
              {c.title}
            </button>
          ))}
          {conversations.length === 0 && <p style={styles.sidebarEmpty}>No conversations yet</p>}
        </div>
      </aside>

      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={{ margin: 0 }}>MK AI Travel Assistant</h2>
          <p style={{ margin: "4px 0 0" }}>Plan your trip with live supplier data where available</p>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            <Link href="/designer" style={{ color: "#2563eb" }}>Trips</Link>
            {" · "}
            <Link href="/bookings" style={{ color: "#2563eb" }}>Bookings</Link>
            {" · "}
            <Link href="/dashboard" style={{ color: "#2563eb" }}>Dashboard</Link>
          </p>
        </div>

        {fallbackMode && (
          <p role="status" style={styles.notice}>
            The AI planner is not configured on this server. Replies are basic scripted guidance, not live search or pricing.
          </p>
        )}

        <div style={styles.messagesArea}>
          {historyError && (
            <p role="alert" style={styles.error}>
              {historyError}
            </p>
          )}
          {messages.length === 0 && (
            <div style={styles.welcomeMessage}>
              <p>Tell me where you&apos;d like to go and I&apos;ll help you plan it.</p>
              <p style={{ fontSize: 13 }}>Try: &quot;5 days in Dubai for 2 adults and 1 child, budget ₹1,20,000&quot;</p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{ ...styles.messageWrapper, justifyContent: msg.role === "USER" ? "flex-end" : "flex-start" }}
            >
              <div
                style={{
                  ...styles.message,
                  backgroundColor: msg.role === "USER" ? "#2563eb" : "#e5e7eb",
                  color: msg.role === "USER" ? "white" : "#1f2937",
                  whiteSpace: "pre-wrap",
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && progress && (
            <p role="status" style={styles.progress}>
              {progress}…
            </p>
          )}

          {itinerary && conversationId && (
            <p style={{ margin: "8px 0" }}>
              <Link href={`/designer/${conversationId}`} style={{ color: "#2563eb", textDecoration: "underline" }}>
                Open in the itinerary designer (edit, reorder, map)
              </Link>
            </p>
          )}
          {itinerary && <ItineraryCards itinerary={itinerary} />}

          {sendError && (
            <p role="alert" style={styles.error}>
              {sendError}
            </p>
          )}
          {activityQuery && <ViatorActivitySearch key={activityQuery} query={activityQuery} />}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} style={styles.form}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about destinations, activities, prices…"
            maxLength={4000}
            disabled={loading}
            style={styles.input}
            aria-label="Message"
          />
          {loading ? (
            <button type="button" onClick={stop} style={{ ...styles.button, backgroundColor: "#6b7280" }}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} style={{ ...styles.button, opacity: input.trim() ? 1 : 0.5 }}>
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function ItineraryCards({ itinerary }: { itinerary: Itinerary }) {
  return (
    <section aria-label="Itinerary" style={styles.itinerary}>
      <h3 style={{ margin: "0 0 8px" }}>{itinerary.title}</h3>
      <p style={styles.legend}>
        Items are marked LIVE only when confirmed by a supplier availability check. Nothing here is booked.
      </p>
      {itinerary.days.map((day) => (
        <div key={day.dayNumber} style={styles.dayCard}>
          <strong>
            Day {day.dayNumber}
            {day.date ? ` · ${day.date}` : ""} — {day.title}
          </strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {day.items.map((item) => {
              const badge = STATUS_STYLE[item.status] ?? STATUS_STYLE.UNVERIFIED;
              return (
                <li key={item.id} style={{ marginBottom: 4 }}>
                  {item.startTime ? `${item.startTime} ` : ""}
                  {item.title}
                  {item.price !== undefined && item.currency ? ` · ${item.currency} ${item.price}` : ""}{" "}
                  <span style={{ ...styles.badge, backgroundColor: badge.bg, color: badge.fg }}>{item.status}</span>
                </li>
              );
            })}
            {day.items.length === 0 && <li style={{ listStyle: "none", color: "#6b7280" }}>Nothing planned yet</li>}
          </ul>
        </div>
      ))}
    </section>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  shell: { display: "flex", height: "100vh", backgroundColor: "#f9fafb" },
  sidebar: {
    width: 240,
    borderRight: "1px solid #e5e7eb",
    backgroundColor: "white",
    display: "flex",
    flexDirection: "column",
    padding: 12,
    gap: 8,
  },
  newChat: {
    padding: "10px 12px",
    border: "1px solid #2563eb",
    color: "#2563eb",
    backgroundColor: "white",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 600,
  },
  sidebarList: { display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" },
  sidebarItem: {
    textAlign: "left",
    padding: "8px 10px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  sidebarEmpty: { color: "#6b7280", fontSize: 13, margin: "8px 4px" },
  container: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#f9fafb",
    overflow: "hidden",
  },
  header: { backgroundColor: "#2563eb", color: "white", padding: "16px 20px", textAlign: "center" },
  notice: { margin: 0, padding: "8px 16px", backgroundColor: "#fef9c3", color: "#854d0e", fontSize: 13 },
  messagesArea: { flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "12px" },
  welcomeMessage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    color: "#6b7280",
    fontSize: "16px",
    textAlign: "center",
    marginTop: "60px",
  },
  messageWrapper: { display: "flex", gap: "12px" },
  message: { maxWidth: "70%", padding: "12px 16px", borderRadius: "12px", wordWrap: "break-word", fontSize: 14, lineHeight: 1.5 },
  progress: { margin: 0, color: "#6b7280", fontSize: 13, fontStyle: "italic" },
  itinerary: { backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 },
  legend: { margin: "0 0 12px", color: "#6b7280", fontSize: 12 },
  dayCard: { borderTop: "1px solid #f3f4f6", padding: "10px 0", fontSize: 14 },
  badge: { fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 999, verticalAlign: "middle" },
  form: { display: "flex", gap: "8px", padding: "16px", borderTop: "1px solid #e5e7eb", backgroundColor: "white" },
  input: { flex: 1, padding: "12px 16px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit" },
  button: { padding: "12px 24px", backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  error: { margin: 0, padding: "10px 12px", borderRadius: 8, backgroundColor: "#fff1ee", color: "#984c3c", fontSize: 13 },
};
