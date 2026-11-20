"use client";

import { useState } from "react";

export default function DebugPage() {
  const [query, setQuery] = useState("Bali for 4 people, 5 days, December");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testAPI = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      // Test parsing
      console.log("Testing query:", query);

      const parseData = {
        destination: "bali",
        travelers: { adults: 4, children: 0 },
        startDate: "2026-12-15",
        endDate: "2026-12-20",
        tripType: "customized",
        activities: ["culture", "adventure"],
        accommodation: "midrange",
        transport: "private",
      };

      console.log("Posting to /api/package/quick with:", parseData);

      const res = await fetch("/api/package/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parseData),
      });

      console.log("Response status:", res.status);
      const data = await res.json();
      console.log("Response data:", data);

      setResponse(data);

      if (!data.success) {
        setError("API returned success: false");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Error:", errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "40px", fontFamily: "monospace", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>🐛 API Debug Tool</h1>
      <p>Test the package/quick API directly</p>

      <div style={{ marginTop: "20px" }}>
        <label>Query: </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", height: "80px", padding: "10px" }}
        />
      </div>

      <button
        onClick={testAPI}
        disabled={loading}
        style={{
          padding: "10px 20px",
          marginTop: "10px",
          cursor: loading ? "not-allowed" : "pointer",
          backgroundColor: "#2563eb",
          color: "white",
          border: "none",
          borderRadius: "4px",
        }}
      >
        {loading ? "Testing..." : "Test API"}
      </button>

      {error && (
        <div
          style={{
            marginTop: "20px",
            padding: "15px",
            backgroundColor: "#fee2e2",
            color: "#991b1b",
            borderRadius: "4px",
          }}
        >
          <strong>❌ Error:</strong>
          <pre style={{ marginTop: "10px", whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      )}

      {response && (
        <div
          style={{
            marginTop: "20px",
            padding: "15px",
            backgroundColor: "#f0fdf4",
            color: "#15803d",
            borderRadius: "4px",
          }}
        >
          <strong>✅ Response:</strong>
          <pre
            style={{
              marginTop: "10px",
              whiteSpace: "pre-wrap",
              overflowX: "auto",
              backgroundColor: "#white",
              padding: "10px",
              borderRadius: "4px",
              color: "#000",
            }}
          >
            {JSON.stringify(response, null, 2)}
          </pre>

          {response.success && response.package && (
            <div style={{ marginTop: "20px" }}>
              <h3>Package Summary:</h3>
              <ul>
                <li><strong>Title:</strong> {response.package.title}</li>
                <li><strong>Destination:</strong> {response.package.destination}</li>
                <li><strong>Total Days:</strong> {response.package.summary.totalDays}</li>
                <li><strong>Travelers:</strong> {response.package.summary.travelers}</li>
                <li><strong>Total Price:</strong> ${response.package.pricing.total}</li>
              </ul>

              <h4>Price Breakdown:</h4>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  marginTop: "10px",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#dbeafe" }}>
                    <th style={{ border: "1px solid #ccc", padding: "8px", textAlign: "left" }}>Item</th>
                    <th style={{ border: "1px solid #ccc", padding: "8px", textAlign: "right" }}>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(response.package.breakdown).map(([key, value]: [string, any]) => (
                    <tr key={key} style={{ backgroundColor: key.includes("TOTAL") ? "#fef3c7" : "white" }}>
                      <td style={{ border: "1px solid #ccc", padding: "8px" }}>{key}</td>
                      <td style={{ border: "1px solid #ccc", padding: "8px", textAlign: "right" }}>
                        {String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: "40px", padding: "20px", backgroundColor: "#f3f4f6", borderRadius: "4px" }}>
        <h3>🔍 Check Browser Console</h3>
        <p>Open DevTools (F12) → Console tab to see detailed logs</p>
        <p>Steps:</p>
        <ol>
          <li>Press F12 to open DevTools</li>
          <li>Go to Console tab</li>
          <li>Try the API above</li>
          <li>Check console for logs and errors</li>
        </ol>
      </div>
    </div>
  );
}
