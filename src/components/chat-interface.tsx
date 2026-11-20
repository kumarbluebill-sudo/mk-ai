"use client";

import { useEffect, useRef, useState } from "react";
import { MessageRole } from "@/generated/prisma/client";
import { ViatorActivitySearch } from "@/components/viator-activity-search";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>("default");
  const [activityQuery, setActivityQuery] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [sendError, setSendError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const loadChatHistory = async () => {
      try {
        const response = await fetch(`/api/chat?id=${conversationId}`);
        const data = (await response.json()) as {
          success?: boolean;
          messages?: Message[];
          error?: string;
        };
        if (!response.ok || !data.success || !Array.isArray(data.messages)) {
          throw new Error(data.error || "Failed to fetch chat history.");
        }
        if (!cancelled) {
          setMessages(data.messages);
          setHistoryError("");
        }
      } catch (error) {
        console.error("Failed to load chat history:", error);
        if (!cancelled) {
          setHistoryError(
            "Saved chat history is unavailable. Live activity search is still available."
          );
        }
      }
    };

    void loadChatHistory();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);
    setSendError("");
    setActivityQuery(
      /\b(price|cost|rate|activity|activities|tour|destination|trip|travel|plan|search|visit|things to do|bali|dubai|kyoto|paris|tokyo|thailand|maldives|jaipur)\b/i.test(
        userMessage
      )
        ? userMessage
        : ""
    );

    try {
      // Add user message to UI immediately
      const tempUserMsg: Message = {
        id: `temp-user-${Date.now()}`,
        role: "USER" as MessageRole,
        content: userMessage,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);

      // Send to API
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: userMessage,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        aiResponse?: string;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.success || typeof data.aiResponse !== "string") {
        throw new Error(data.message || data.error || "Chat request failed.");
      }

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        role: "ASSISTANT" as MessageRole,
        content: data.aiResponse,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (error) {
      console.error("Failed to send message:", error);
      setSendError(
        "Chat could not finish this message; it may not have been saved. Live activity search is still available."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container" style={styles.container}>
      <div style={styles.header}>
        <h2>✨ MK AI Travel Assistant</h2>
        <p>Plan your perfect trip with AI guidance</p>
      </div>

      <div style={styles.messagesArea}>
        {historyError && (
          <p role="alert" style={styles.error}>
            {historyError}
          </p>
        )}
        {messages.length === 0 && (
          <div style={styles.welcomeMessage}>
            <p>👋 Welcome! I&apos;m your travel planning assistant.</p>
            <p>Tell me where you&apos;d like to go, and I&apos;ll help you plan!</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              ...styles.messageWrapper,
              justifyContent:
                msg.role === "USER" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                ...styles.message,
                backgroundColor:
                  msg.role === "USER" ? "#2563eb" : "#e5e7eb",
                color: msg.role === "USER" ? "white" : "#1f2937",
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {sendError && (
          <p role="alert" style={styles.error}>
            {sendError}
          </p>
        )}
        {activityQuery && (
          <ViatorActivitySearch key={activityQuery} query={activityQuery} />
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={sendMessage} style={styles.form}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about destinations, prices, bookings..."
          disabled={loading}
          style={styles.input}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            ...styles.button,
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          {loading ? "⏳ Thinking..." : "Send ➤"}
        </button>
      </form>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: "#f9fafb",
    borderRadius: "12px",
    boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
    overflow: "hidden",
  },
  header: {
    backgroundColor: "#2563eb",
    color: "white",
    padding: "20px",
    textAlign: "center",
    borderBottom: "1px solid #1e40af",
  },
  messagesArea: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  welcomeMessage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    color: "#6b7280",
    fontSize: "16px",
    textAlign: "center",
    marginTop: "60px",
  },
  messageWrapper: {
    display: "flex",
    gap: "12px",
  },
  message: {
    maxWidth: "70%",
    padding: "12px 16px",
    borderRadius: "12px",
    wordWrap: "break-word",
    fontSize: "14px",
    lineHeight: "1.5",
  },
  form: {
    display: "flex",
    gap: "8px",
    padding: "16px",
    borderTop: "1px solid #e5e7eb",
    backgroundColor: "white",
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    outline: "none",
    fontFamily: "inherit",
  },
  button: {
    padding: "12px 24px",
    backgroundColor: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "600",
    fontSize: "14px",
    transition: "background-color 0.2s",
  },
  error: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: "8px",
    backgroundColor: "#fff1ee",
    color: "#984c3c",
    fontSize: "13px",
  },
};
