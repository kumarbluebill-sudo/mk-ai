"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, CalendarDays,
  Check, ChevronDown, CircleHelp, Compass, FileText, Globe2, Headphones,
  Home, MapPin, Menu, MessageCircle, MoreHorizontal, Plane, Plus, Search,
  Send, Settings2, ShieldCheck, Sparkles, Users, Wallet, X,
} from "lucide-react";
import { destinations, type Destination } from "@/lib/destinations";

type Conversation = { id: string; title: string; date: string; prompt: string };
type SearchResult = { source: string; liveInventory: boolean; results: Destination[] };
const initialTrips: Conversation[] = [
  { id: "1", title: "A long weekend in Kyoto", date: "Today", prompt: "A long weekend in Kyoto" },
  { id: "2", title: "Bali with the family", date: "Yesterday", prompt: "Bali with the family" },
  { id: "3", title: "A quiet escape to Tuscany", date: "Oct 12", prompt: "A quiet escape to Tuscany" },
];

const navPrimary = [
  { label: "Overview", icon: Home }, { label: "New trip", icon: Plus },
  { label: "Saved trips", icon: Bookmark }, { label: "My quotations", icon: FileText },
  { label: "My bookings", icon: Plane },
];

export default function HomePage() {
  const [active, setActive] = useState("Overview");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Destination[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [trips, setTrips] = useState(initialTrips);
  const [savedSlugs, setSavedSlugs] = useState<string[]>([]);
  const [selected, setSelected] = useState<Destination | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("mk-travel-conversations");
    if (saved) try {
      // Browser-only history is hydrated after the server-rendered view.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrips(JSON.parse(saved));
    } catch { /* use examples */ }
    const savedPlaces = localStorage.getItem("mk-travel-saved-places");
    if (savedPlaces) try {
      setSavedSlugs(JSON.parse(savedPlaces));
    } catch { /* use empty list */ }
  }, []);

  const handleSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!query.trim()) return;
    const title = query.trim().length > 32 ? `${query.trim().slice(0, 32)}…` : query.trim();
    const updatedTrips = [{ id: crypto.randomUUID(), title, date: "Just now", prompt: query.trim() }, ...trips].slice(0, 20);
    setTrips(updatedTrips);
    localStorage.setItem("mk-travel-conversations", JSON.stringify(updatedTrips));
    setSearching(true);
    setResults(null);
    setActive("New trip");

    try {
      // Check if query is conversational (contains numbers, dates, or activity keywords)
      const isConversational = /(\d+\s*(people|adults?|kids?|children|days?|nights?)|\d{1,2}[-\/]\d{1,2}|december|january|adventure|culture|food|relaxation|private|luxury|budget)/i.test(query);

      if (isConversational) {
        // Parse conversational query and create package (using quick API - no database needed)
        const packageData = parseConversationalQuery(query);
        try {
          const packageResponse = await fetch("/api/package/quick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(packageData),
          });

          const result = await packageResponse.json();
          if (result.success && result.package) {
            // Display package as a special result
            const pkg = result.package;
            setResults([{
              name: pkg.title,
              slug: pkg.reference,
              country: pkg.destination,
              region: "Custom Package",
              tagline: pkg.summary.travelers + " • " + pkg.summary.totalDays + " days • $" + pkg.pricing.total + " USD",
              image: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=85",
              startingAt: pkg.pricing.total,
              days: pkg.summary.totalDays,
              highlights: [pkg.summary.tripType, ...pkg.summary.activities],
            }]);
          } else {
            throw new Error("Invalid response");
          }
        } catch (err) {
          console.error("Package error:", err);
          const response = await fetch(`/api/destinations?q=${encodeURIComponent(query)}`);
          const data = (await response.json()) as SearchResult;
          setResults(data.results);
        }
      } else {
        // Regular destination search
        const response = await fetch(`/api/destinations?q=${encodeURIComponent(query)}`);
        const data = (await response.json()) as SearchResult;
        setResults(data.results);
      }
    } catch {
      setResults(destinations.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())));
    } finally {
      setSearching(false);
    }
  };

  // Helper function to parse conversational query
  const parseConversationalQuery = (query: string) => {
    const destinations_list = ["bali", "dubai", "kyoto", "paris", "tokyo", "thailand", "maldives"];
    let destination = "bali";

    for (const dest of destinations_list) {
      if (query.toLowerCase().includes(dest)) {
        destination = dest;
        break;
      }
    }

    const adultsMatch = query.match(/(\d+)\s*(?:adult|people|person)/i);
    const childrenMatch = query.match(/(\d+)\s*(?:child|kid)/i);
    const daysMatch = query.match(/(\d+)\s*days?/i);

    const adults = adultsMatch ? parseInt(adultsMatch[1]) : 2;
    const children = childrenMatch ? parseInt(childrenMatch[1]) : 0;
    const days = daysMatch ? parseInt(daysMatch[1]) : 5;

    // Determine month
    let month = 12; // December default
    const months: { [key: string]: number } = {
      january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
      july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    };
    for (const [name, num] of Object.entries(months)) {
      if (query.toLowerCase().includes(name)) month = num;
    }

    const startDate = `2026-${String(month).padStart(2, "0")}-15`;
    const endDate = new Date(new Date(startDate).getTime() + days * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];

    // Determine trip type and activities
    let tripType: "private" | "customized" | "group" = "customized";
    if (query.toLowerCase().includes("private")) tripType = "private";
    else if (query.toLowerCase().includes("group")) tripType = "group";

    const activities = [];
    if (query.toLowerCase().includes("adventure")) activities.push("adventure");
    if (query.toLowerCase().includes("culture")) activities.push("culture");
    if (query.toLowerCase().includes("food")) activities.push("food");
    if (query.toLowerCase().includes("relax")) activities.push("relaxation");
    if (activities.length === 0) activities.push("culture", "adventure");

    let accommodation: "budget" | "midrange" | "luxury" = "midrange";
    if (query.toLowerCase().includes("luxury")) accommodation = "luxury";
    else if (query.toLowerCase().includes("budget")) accommodation = "budget";

    return {
      destination,
      travelers: { adults, children },
      startDate,
      endDate,
      tripType,
      activities,
      accommodation,
      transport: "private",
    };
  };

  const startTrip = (prompt: string) => {
    setQuery(prompt);
    setActive("New trip");
    setResults(null);
    setTimeout(() => document.getElementById("trip-prompt")?.focus(), 10);
  };

  const sectionTitle = active === "Overview" ? "A little inspiration goes a long way." : active;
  const visibleDestinations = useMemo(() => active === "Saved trips" ? destinations.filter((d) => savedSlugs.includes(d.slug)) : results ?? destinations, [active, results, savedSlugs]);
  const toggleSaved = (slug: string) => {
    const next = savedSlugs.includes(slug) ? savedSlugs.filter((item) => item !== slug) : [...savedSlugs, slug];
    setSavedSlugs(next);
    localStorage.setItem("mk-travel-saved-places", JSON.stringify(next));
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${drawer ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><Compass size={20} strokeWidth={1.8} /></div>
          <span className="brand-name">mk<span>travel</span></span>
          <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={18} /></button>
        </div>
        <button className="workspace-switch"><div className="workspace-avatar">M</div><span><strong>MK Solutions</strong><small>Travel workspace</small></span><ChevronDown size={15} /></button>
        <button className="new-trip-button" onClick={() => startTrip("")}><Plus size={17} /> Plan a new trip <span>⌘ K</span></button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav-list">
          {navPrimary.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => { setActive(label); setResults(null); setSelected(null); setDrawer(false); }}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === "My quotations" && <span className="nav-count">2</span>}</button>)}
        </nav>
        <div className="sidebar-divider" />
        <div className="section-heading"><span className="nav-label">RECENT TRIPS</span><button className="icon-button tiny" aria-label="More recent trips"><MoreHorizontal size={17} /></button></div>
        <div className="recent-list">{trips.slice(0, 5).map((trip) => <button key={trip.id} className="recent-item" onClick={() => startTrip(trip.prompt)}><MessageCircle size={15} /><span>{trip.title}</span></button>)}</div>
        <button className="show-all" onClick={() => setActive("Saved trips")}>View all trips <ArrowRight size={14} /></button>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setActive("Settings")}><Settings2 size={17} /><span>Settings</span></button>
          <button className="nav-item" onClick={() => setActive("Help & support")}><CircleHelp size={17} /><span>Help & support</span></button>
          <div className="profile-card"><div className="profile-avatar">AS</div><span><strong>Alexandra Smith</strong><small>Personal account</small></span><MoreHorizontal size={18} className="muted-icon" /></div>
        </div>
      </aside>

      {drawer && <button aria-label="Close navigation" className="drawer-backdrop" onClick={() => setDrawer(false)} />}

      <section className="main-area">
        <header className="topbar"><button aria-label="Open navigation" className="icon-button menu-button" onClick={() => setDrawer(true)}><Menu size={19} /></button><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{active}</strong></div><div className="top-actions"><div className="secure-label"><ShieldCheck size={14} /> Your trips, thoughtfully planned</div><button className="help-button" onClick={() => setActive("Help & support")}><Headphones size={16} /><span>Get help</span></button><div className="top-avatar">AS</div></div></header>

        <div className="page-content">
          {selected ? <DestinationDetail destination={selected} onBack={() => setSelected(null)} onStart={(name) => { setSelected(null); startTrip(`Plan a trip to ${name}`); }} /> : <>
            <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> MADE FOR THE WAY YOU TRAVEL</div><h1>{active === "Overview" ? <>Travel that feels<br className="desktop-break" /> <em>like you.</em></> : sectionTitle}</h1><p className="welcome-copy">A thoughtful itinerary starts with a conversation.<br className="desktop-break" /> Tell us what you have in mind — we’ll take it from there.</p></div><div className="welcome-stamp"><Globe2 size={18} /><span>Good journeys<br />start with a little wonder.</span></div></section>

            <section className="search-panel"><form onSubmit={handleSearch} className="prompt-form"><div className="prompt-icon"><Sparkles size={18} /></div><textarea id="trip-prompt" rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Where would you like to go? Tell us the little details…" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSearch(); } }} /><button className="send-button" type="submit" aria-label="Search trips" disabled={!query.trim() || searching}>{searching ? <span className="spinner" /> : <ArrowRight size={19} />}</button></form><div className="prompt-footer"><div className="prompt-hints"><span><MapPin size={13} /> Destination</span><span><CalendarDays size={13} /> Dates</span><span><Users size={13} /> Travellers</span><span><Wallet size={13} /> Budget</span></div><button className="voice-button" type="button" title="Voice input coming soon"><span className="voice-wave">▮▮▮</span> Voice <span className="coming-soon">SOON</span></button></div></section>

            <div className="quick-prompts"><span className="quick-label">NEED A LITTLE INSPIRATION?</span><div className="prompt-chips"><button onClick={() => startTrip("A relaxed beach escape")}>☼ &nbsp;Somewhere by the sea</button><button onClick={() => startTrip("A long weekend in Japan")}>↗ &nbsp;A long weekend away</button><button onClick={() => startTrip("A family trip with the kids")}>♡ &nbsp;A family adventure</button></div></div>

            <section className="destinations-section"><div className="section-title-row"><div><div className="section-kicker">THE WORLD, AT YOUR PACE</div><h2>{results ? `A few ideas for “${query}”` : "Places worth getting lost in"}</h2></div><button className="view-all" onClick={() => { setQuery(""); setResults(destinations); }}>Explore all <ArrowRight size={15} /></button></div>
              {searching ? <div className="loading-grid">{[1, 2, 3].map((n) => <div className="skeleton-card" key={n}><div className="skeleton-image" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}</div> : visibleDestinations.length ? <div className="destination-grid">{visibleDestinations.slice(0, 3).map((d, i) => <DestinationCard key={d.slug} destination={d} index={i} saved={savedSlugs.includes(d.slug)} onSave={() => toggleSaved(d.slug)} onSelect={() => setSelected(d)} />)}</div> : <div className="empty-results"><Search size={20} /><strong>{active === "Saved trips" ? "No saved places yet" : `No sample destinations found for “${query}”`}</strong><span>{active === "Saved trips" ? "Tap the bookmark on a destination card to keep it here." : "Try Dubai, Bali, Kyoto, Jaipur or ask for a type of trip."}</span></div>}
              <div className="demo-note"><span className="demo-dot" /><span><strong>Destination ideas · Demo data</strong> &nbsp;Images and sample budgets are illustrative. No live inventory has been searched.</span><ArrowUpRight size={14} /></div>
            </section>
            <footer className="page-footer"><span>© 2026 MK Solutions</span><span>Made for memorable journeys <span className="footer-star">✳</span></span><button onClick={() => setActive("Privacy & trust")}>Privacy & trust</button></footer>
          </>}
        </div>
      </section>
    </main>
  );
}

function DestinationCard({ destination, index, saved, onSave, onSelect }: { destination: Destination; index: number; saved: boolean; onSave: () => void; onSelect: () => void }) {
  return <article className="destination-card" onClick={onSelect} onKeyDown={(e) => e.key === "Enter" && onSelect()} tabIndex={0} role="button" aria-label={`Explore ${destination.name}`}><div className="destination-image" style={{ backgroundImage: `url('${destination.image}')` }}><span className="destination-tag">{destination.region}</span><button aria-label={`${saved ? "Remove" : "Save"} ${destination.name}`} className={`save-button ${saved ? "saved" : ""}`} onClick={(e) => { e.stopPropagation(); onSave(); }}><Bookmark size={15} /></button><span className="image-index">0{index + 1} <span>/ 06</span></span></div><div className="destination-details"><div><h3>{destination.name}<span>, {destination.country}</span></h3><p>{destination.tagline}</p></div><div className="destination-meta"><span><CalendarDays size={13} /> {destination.days} days</span><span className="price-hint">Ideas from <strong>₹{destination.startingAt.toLocaleString("en-IN")}</strong></span></div><div className="card-underline"><span>Explore destination</span><ArrowRight size={15} /></div></div></article>;
}

function DestinationDetail({ destination, onBack, onStart }: { destination: Destination; onBack: () => void; onStart: (name: string) => void }) {
  return <section className="detail-page"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to inspiration</button><div className="detail-hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(12,34,29,.72),rgba(12,34,29,.06)),url('${destination.image}')` }}><span>{destination.region} · {destination.country}</span><h1>{destination.name}</h1><p>{destination.tagline}</p><button className="detail-cta" onClick={() => onStart(destination.name)}>Plan a trip here <ArrowRight size={16} /></button></div><div className="detail-content"><div><div className="section-kicker">A PLACE TO REMEMBER</div><h2>Make it your own.</h2><p className="detail-copy">A little inspiration for your {destination.days}-day escape. Tell us what you love and we’ll shape a trip around it.</p><div className="detail-facts"><span><CalendarDays size={16} /> Suggested stay <strong>{destination.days} days</strong></span><span><Wallet size={16} /> Example budget <strong>₹{destination.startingAt.toLocaleString("en-IN")}+</strong></span></div></div><div className="highlights-box"><span className="section-kicker">A FEW HIGHLIGHTS</span>{destination.highlights.map((highlight, i) => <div className="highlight-row" key={highlight}><span>0{i + 1}</span><strong>{highlight}</strong><ArrowUpRight size={15} /></div>)}<p className="detail-disclaimer">Ideas for inspiration only · Demo data, not a live offer</p></div></div></section>;
}
