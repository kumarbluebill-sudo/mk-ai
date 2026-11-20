"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface SearchBuilderProps {
  onSearch: (query: string) => void;
  isLoading?: boolean;
}

export function SearchBuilder({ onSearch, isLoading }: SearchBuilderProps) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [destination, setDestination] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activities, setActivities] = useState<string[]>(["culture"]);

  const destinations = ["Bali", "Dubai", "Kyoto", "Paris", "Thailand", "Maldives", "Italy"];
  const activityOptions = ["culture", "adventure", "food", "relaxation", "nature"];

  const buildQuery = () => {
    const parts = [];
    if (destination) parts.push(destination);
    if (adults || children) {
      const travelers = `${adults} ${adults === 1 ? "adult" : "adults"}${children ? ` ${children} ${children === 1 ? "child" : "children"}` : ""}`;
      parts.push(travelers);
    }
    if (startDate && endDate) {
      const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
      parts.push(`${days} days`);
    }
    if (activities.length > 0) {
      parts.push(activities.join(", "));
    }

    const query = parts.join(", ");
    if (query.trim()) {
      onSearch(query);
      setShowBuilder(false);
    }
  };

  const toggleActivity = (activity: string) => {
    setActivities(prev =>
      prev.includes(activity)
        ? prev.filter(a => a !== activity)
        : [...prev, activity]
    );
  };

  if (showBuilder) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2>Build Your Trip</h2>
            <button onClick={() => setShowBuilder(false)} style={styles.closeBtn}>
              <X size={24} />
            </button>
          </div>

          <div style={styles.form}>
            {/* Destination */}
            <div style={styles.formGroup}>
              <label style={styles.label}>📍 Where?</label>
              <div style={styles.destinationGrid}>
                {destinations.map(dest => (
                  <button
                    key={dest}
                    onClick={() => setDestination(dest)}
                    style={{
                      ...styles.destButton,
                      backgroundColor: destination === dest ? "#2563eb" : "#e5e7eb",
                      color: destination === dest ? "white" : "#1f2937",
                    }}
                  >
                    {dest}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Or type a destination..."
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                style={styles.input}
              />
            </div>

            {/* Travelers */}
            <div style={styles.formGroup}>
              <label style={styles.label}>👥 Travelers</label>
              <div style={styles.travelersGrid}>
                <div>
                  <label style={styles.smallLabel}>Adults</label>
                  <input
                    type="number"
                    min="1"
                    value={adults}
                    onChange={(e) => setAdults(parseInt(e.target.value) || 1)}
                    style={styles.numberInput}
                  />
                </div>
                <div>
                  <label style={styles.smallLabel}>Children</label>
                  <input
                    type="number"
                    min="0"
                    value={children}
                    onChange={(e) => setChildren(parseInt(e.target.value) || 0)}
                    style={styles.numberInput}
                  />
                </div>
              </div>
            </div>

            {/* Dates */}
            <div style={styles.formGroup}>
              <label style={styles.label}>📅 When?</label>
              <div style={styles.datesGrid}>
                <div>
                  <label style={styles.smallLabel}>Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div>
                  <label style={styles.smallLabel}>End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>
            </div>

            {/* Activities */}
            <div style={styles.formGroup}>
              <label style={styles.label}>🎯 Interests</label>
              <div style={styles.activitiesGrid}>
                {activityOptions.map(activity => (
                  <button
                    key={activity}
                    onClick={() => toggleActivity(activity)}
                    style={{
                      ...styles.activityButton,
                      backgroundColor: activities.includes(activity) ? "#2563eb" : "#e5e7eb",
                      color: activities.includes(activity) ? "white" : "#1f2937",
                    }}
                  >
                    {activity}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={buildQuery}
              disabled={isLoading || !destination}
              style={{
                ...styles.submitButton,
                opacity: !destination ? 0.5 : 1,
                cursor: !destination ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Searching..." : "Search Now"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setShowBuilder(true)} style={styles.openButton}>
      Build Trip
    </button>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  openButton: {
    padding: "8px 16px",
    backgroundColor: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
  },
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    backgroundColor: "white",
    borderRadius: "12px",
    maxWidth: "600px",
    width: "90%",
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 20px 25px rgba(0,0,0,0.15)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "24px",
    borderBottom: "1px solid #e5e7eb",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "8px",
  },
  form: {
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  label: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#1f2937",
  },
  smallLabel: {
    fontSize: "12px",
    color: "#6b7280",
  },
  destinationGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
    gap: "8px",
  },
  destButton: {
    padding: "8px 12px",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    transition: "all 0.2s",
  },
  input: {
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
    fontFamily: "inherit",
  },
  travelersGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  numberInput: {
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
  },
  datesGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  activitiesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
    gap: "8px",
  },
  activityButton: {
    padding: "8px 12px",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    transition: "all 0.2s",
  },
  submitButton: {
    padding: "12px 24px",
    backgroundColor: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: "600",
    marginTop: "12px",
  },
};
