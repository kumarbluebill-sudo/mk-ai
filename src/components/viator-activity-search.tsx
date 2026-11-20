"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Search, ShieldCheck } from "lucide-react";

type Activity = {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  currency: string;
};

type PriceSlot = {
  productOptionCode?: string;
  startTime?: string;
  available: boolean;
  price: number | null;
  currency: string;
};

type QuoteResponse = {
  success: boolean;
  bookableItems: PriceSlot[];
  currency: string;
};

type SearchResponse = {
  activities: Activity[];
};

type ActivityQuote = {
  quoteKey: string;
  response: QuoteResponse;
};

function defaultTravelDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function travelerCount(prompt: string, pattern: RegExp, fallback: number): number {
  const match = prompt.match(pattern);
  if (!match) return fallback;
  const count = Number(match[1]);
  return Number.isInteger(count) ? Math.max(0, Math.min(15, count)) : fallback;
}

function searchTermFromPrompt(prompt: string): string {
  const term = prompt
    .replace(/\b\d+\s*(?:adults?|people|persons?|travelers?|children|kids?)\b/gi, " ")
    .replace(/\b\d+\s*(?:days?|nights?)\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
      " "
    )
    .replace(/\b(?:please|plan|trip|travel|vacation|for|with|in|to|a|the)\b/gi, " ")
    .replace(/[,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return term || prompt.trim();
}

function quoteIdentity(
  activityId: string,
  date: string,
  adults: number,
  children: number
): string {
  return `${activityId}:${date}:${adults}:${children}`;
}

function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(price);
}

export function ViatorActivitySearch({ query }: { query: string }) {
  const [travelDate, setTravelDate] = useState(defaultTravelDate);
  const [adults, setAdults] = useState(() =>
    Math.max(
      1,
      travelerCount(
        query,
        /\b(\d+)\s*(?:adults?|people|persons?|travelers?)\b/i,
        2
      )
    )
  );
  const [children, setChildren] = useState(() =>
    travelerCount(query, /\b(\d+)\s*(?:children|kids?)\b/i, 0)
  );
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [quote, setQuote] = useState<ActivityQuote | null>(null);
  const [checkingId, setCheckingId] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadActivities = async () => {
      setLoading(true);
      setSearchError("");
      setQuote(null);
      setQuoteError("");

      try {
        const keyword = searchTermFromPrompt(query);
        const params = new URLSearchParams({
          keyword,
          startDate: travelDate,
          currency: "USD",
        });
        const response = await fetch(`/api/viator/activities?${params}`);
        const data = (await response.json()) as SearchResponse & {
          error?: string;
          message?: string;
        };

        if (!response.ok) {
          throw new Error(data.message || data.error || "Viator search failed.");
        }
        if (!Array.isArray(data.activities)) {
          throw new Error("Viator returned an unexpected search response.");
        }
        if (!cancelled) setActivities(data.activities);
      } catch (error) {
        console.error("Live Viator activity search failed:", error);
        if (!cancelled) {
          setActivities([]);
          setSearchError(
            error instanceof Error ? error.message : "Live search failed."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadActivities();
    return () => {
      cancelled = true;
    };
  }, [query, retry, travelDate]);

  const checkPrice = async (activity: Activity) => {
    const quoteKey = quoteIdentity(activity.id, travelDate, adults, children);
    setCheckingId(activity.id);
    setQuote(null);
    setQuoteError("");

    try {
      const response = await fetch("/api/viator/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: activity.id,
          date: travelDate,
          adults,
          children,
          currency: "USD",
        }),
      });
      const data = (await response.json()) as QuoteResponse & {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(data.message || data.error || "Live price check failed.");
      }
      if (!Array.isArray(data.bookableItems)) {
        throw new Error("Viator returned an unexpected pricing response.");
      }

      setQuote({ quoteKey, response: data });
    } catch (error) {
      console.error("Live Viator price check failed:", error);
      setQuoteError(
        error instanceof Error ? error.message : "Live price check failed."
      );
    } finally {
      setCheckingId("");
    }
  };

  return (
    <section
      aria-live="polite"
      style={{
        marginTop: 16,
        padding: 18,
        border: "1px solid #e8eae5",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldCheck size={17} color="#3a6a58" />
        <strong style={{ color: "#26312d" }}>Live Viator activities</strong>
        <span style={{ marginLeft: "auto", color: "#738078", fontSize: 11 }}>
          Supplier prices, not trip-package estimates
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "end",
          gap: 12,
          margin: "15px 0",
        }}
      >
        <label style={fieldStyle}>
          Travel date
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={travelDate}
            onChange={(event) => setTravelDate(event.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          Adults
          <input
            type="number"
            min={1}
            max={15}
            value={adults}
            onChange={(event) =>
              setAdults(Math.max(1, Math.min(15, Number(event.target.value) || 1)))
            }
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          Children
          <input
            type="number"
            min={0}
            max={14}
            value={children}
            onChange={(event) =>
              setChildren(Math.max(0, Math.min(14, Number(event.target.value) || 0)))
            }
            style={inputStyle}
          />
        </label>
      </div>

      {loading && (
        <p style={statusStyle}>
          <span className="spinner" style={{ backgroundColor: "#214d40" }} />
          Searching Viator live inventory…
        </p>
      )}
      {!loading && searchError && (
        <div role="alert" style={errorStyle}>
          <span>{searchError}</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Try again
          </button>
        </div>
      )}
      {quoteError && <p role="alert" style={errorStyle}>{quoteError}</p>}
      {!loading && !searchError && activities.length === 0 && (
        <p style={statusStyle}>
          No live Viator activities matched this search. Try another destination
          or activity.
        </p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {activities.map((activity) => {
          const currentQuote =
            quote?.quoteKey ===
            quoteIdentity(activity.id, travelDate, adults, children)
              ? quote.response
              : undefined;
          const availableSlots =
            currentQuote?.bookableItems.filter(
              (slot) => slot.available && slot.price !== null
            ) ?? [];

          return (
            <article
              key={activity.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: 12,
                border: "1px solid #eceee8",
                borderRadius: 9,
              }}
            >
              {activity.imageUrl && (
                // Viator returns supplier-hosted image URLs.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activity.imageUrl}
                  alt=""
                  width={72}
                  height={64}
                  style={{ objectFit: "cover", borderRadius: 7 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 13 }}>
                  {activity.title}
                </strong>
                <span style={{ color: "#7d8680", fontSize: 11 }}>
                  {activity.id} · Choose a date and check supplier availability
                </span>
                {currentQuote && (
                  availableSlots.length ? (
                    <div style={{ marginTop: 8, color: "#214d40", fontSize: 12 }}>
                      <CheckCircle2
                        size={14}
                        style={{ verticalAlign: "middle", marginRight: 5 }}
                      />
                      Live price:{" "}
                      <strong>
                        {formatPrice(availableSlots[0].price ?? 0, availableSlots[0].currency)}
                      </strong>
                      {availableSlots[0].startTime && (
                        <span> · {availableSlots[0].startTime}</span>
                      )}
                      {availableSlots.length > 1 && (
                        <span style={{ display: "block", marginTop: 4 }}>
                          {availableSlots.length} available time slots returned
                        </span>
                      )}
                    </div>
                  ) : (
                    <span
                      style={{
                        display: "block",
                        marginTop: 8,
                        color: "#8a563a",
                        fontSize: 12,
                      }}
                    >
                      No available live price for this date and traveler mix.
                    </span>
                  )
                )}
              </div>
              <button
                type="button"
                onClick={() => void checkPrice(activity)}
                disabled={Boolean(checkingId) || !travelDate}
                style={checkButtonStyle}
              >
                {checkingId === activity.id ? (
                  "Checking…"
                ) : (
                  <>
                    <Clock3 size={14} /> Check live price
                  </>
                )}
              </button>
            </article>
          );
        })}
      </div>

      <p style={{ margin: "12px 0 0", color: "#89928b", fontSize: 10 }}>
        <Search size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />
        Final amount is shown only after a live Viator availability check. Hotels,
        flights and transfers are not included.
      </p>
    </section>
  );
}

const fieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  color: "#68756c",
  fontSize: 11,
};

const inputStyle: React.CSSProperties = {
  minWidth: 125,
  padding: "8px 9px",
  border: "1px solid #dfe3dc",
  borderRadius: 6,
  color: "#36443a",
  background: "#fff",
};

const statusStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#758078",
  fontSize: 12,
};

const errorStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: 10,
  borderRadius: 7,
  background: "#fff1ee",
  color: "#984c3c",
  fontSize: 12,
};

const checkButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
  padding: "9px 11px",
  border: 0,
  borderRadius: 7,
  background: "#214d40",
  color: "#fff",
  fontSize: 11,
};
