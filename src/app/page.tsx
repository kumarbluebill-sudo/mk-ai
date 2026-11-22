"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, CalendarDays,
  Check, ChevronDown, CircleHelp, Compass, FileText, Globe2, Headphones,
  Home, MapPin, Menu, MessageCircle, MoreHorizontal, Plane, Plus, Search,
  Send, Settings2, ShieldCheck, Sparkles, Users, Wallet, X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { ChatInterface } from "@/components/chat-interface";
import { destinations, type Destination } from "@/lib/destinations";

type Conversation = { id: string; title: string };
type ChatSession = { key: number; prompt?: string; conversationId?: string };

const navPrimary = [{ label: "Overview", icon: Home }, { label: "Saved trips", icon: Bookmark }];
const navLinks = [
  { href: "/designer", label: "Trips & itineraries", icon: Compass },
  { href: "/bookings", label: "Quotes & bookings", icon: Plane },
  { href: "/dashboard", label: "Dashboard", icon: FileText },
  { href: "/team", label: "Team", icon: Users },
];

export default function HomePage() {
  const [active, setActive] = useState("Overview");
  const [query, setQuery] = useState("");
  const [chat, setChat] = useState<ChatSession | null>(null);
  const [details, setDetails] = useState({ destination: "", start: "", end: "", adults: "2", children: "0", budget: "" });
  const [drawer, setDrawer] = useState(false);
  const [trips, setTrips] = useState<Conversation[]>([]);
  const [savedSlugs, setSavedSlugs] = useState<string[]>([]);
  const [selected, setSelected] = useState<Destination | null>(null);

  useEffect(() => {
    const savedPlaces = localStorage.getItem("mk-travel-saved-places");
    if (savedPlaces) try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedSlugs(JSON.parse(savedPlaces));
    } catch { /* use empty list */ }
    fetch("/api/chat").then((r) => r.json()).then((d: { conversations?: Conversation[] }) => {
      if (Array.isArray(d.conversations)) setTrips(d.conversations);
    }).catch(() => { /* recent trips are optional */ });
  }, [chat]);

  // The search box is the chat: submitting starts (or continues) a conversation with the agent.
  const handleSearch = (event?: FormEvent) => {
    event?.preventDefault();
    const parts: string[] = [];
    if (query.trim()) parts.push(query.trim());
    if (details.destination.trim()) parts.push(`Destination: ${details.destination.trim()}`);
    if (details.start) parts.push(`Travel dates: ${details.start}${details.end ? ` to ${details.end}` : ""}`);
    if (details.destination.trim() || details.start || query.trim()) {
      parts.push(`Travellers: ${Number(details.adults) || 1} adult(s)${Number(details.children) > 0 ? `, ${Number(details.children)} child(ren)` : ""}`);
    }
    if (details.budget.trim()) parts.push(`Budget: ${details.budget.trim()}`);
    const prompt = parts.join(". ");
    if (!prompt) return;
    setChat({ key: Date.now(), prompt });
    setActive("New trip");
    setQuery("");
    setDetails({ destination: "", start: "", end: "", adults: "2", children: "0", budget: "" });
  };

  const startTrip = (prompt: string) => {
    setSelected(null);
    setActive("New trip");
    if (prompt) setChat({ key: Date.now(), prompt });
    else {
      setChat(null);
      setQuery("");
      setTimeout(() => document.getElementById("trip-prompt")?.focus(), 10);
    }
  };

  const sectionTitle = active === "Overview" ? "A little inspiration goes a long way." : active;
  const visibleDestinations = useMemo(() => active === "Saved trips" ? destinations.filter((d) => savedSlugs.includes(d.slug)) : destinations, [active, savedSlugs]);
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
          {navPrimary.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${active === label ? "active" : ""}`} onClick={() => { setActive(label); setChat(null); setSelected(null); setDrawer(false); }}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>)}
          {navLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="nav-item" style={{ textDecoration: "none" }}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-divider" />
        <div className="section-heading"><span className="nav-label">RECENT TRIPS</span><button className="icon-button tiny" aria-label="More recent trips"><MoreHorizontal size={17} /></button></div>
        <div className="recent-list">{trips.length === 0 && <span className="recent-item" style={{ cursor: "default" }}>No trips yet</span>}{trips.slice(0, 6).map((trip) => <button key={trip.id} className="recent-item" onClick={() => { setSelected(null); setActive("New trip"); setChat({ key: Date.now(), conversationId: trip.id }); }}><MessageCircle size={15} /><span>{trip.title}</span></button>)}</div>
        <Link href="/designer" className="show-all" style={{ textDecoration: "none" }}>View all trips <ArrowRight size={14} /></Link>
        <div className="sidebar-bottom">
          <Link href="/settings/security" className="nav-item" style={{ textDecoration: "none" }}><Settings2 size={17} /><span>Security</span></Link>
          <button className="nav-item" onClick={() => void signOut({ callbackUrl: "/login" })}><X size={17} /><span>Sign out</span></button>
        </div>
      </aside>

      {drawer && <button aria-label="Close navigation" className="drawer-backdrop" onClick={() => setDrawer(false)} />}

      <section className="main-area">
        <header className="topbar"><button aria-label="Open navigation" className="icon-button menu-button" onClick={() => setDrawer(true)}><Menu size={19} /></button><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{active}</strong></div><div className="top-actions"><div className="secure-label"><ShieldCheck size={14} /> Your trips, thoughtfully planned</div></div></header>

        {chat ? <ChatInterface key={chat.key} embedded initialMessage={chat.prompt} initialConversationId={chat.conversationId} /> : <div className="page-content">
          {selected ? <DestinationDetail destination={selected} onBack={() => setSelected(null)} onStart={(name) => { setSelected(null); startTrip(`Plan a trip to ${name}`); }} /> : <>
            <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> MADE FOR THE WAY YOU TRAVEL</div><h1>{active === "Overview" ? <>Travel that feels<br className="desktop-break" /> <em>like you.</em></> : sectionTitle}</h1><p className="welcome-copy">A thoughtful itinerary starts with a conversation.<br className="desktop-break" /> Tell us what you have in mind — we’ll take it from there.</p></div><div className="welcome-stamp"><Globe2 size={18} /><span>Good journeys<br />start with a little wonder.</span></div></section>

            <section className="search-panel"><form onSubmit={handleSearch} className="prompt-form"><div className="prompt-icon"><Sparkles size={18} /></div><textarea id="trip-prompt" rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Where would you like to go? Tell us the little details…" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSearch(); } }} /><button className="send-button" type="submit" aria-label="Search trips" disabled={!query.trim() && !details.destination.trim()}><ArrowRight size={19} /></button></form><div className="prompt-footer" style={{ flexWrap: "wrap", gap: 8, padding: "8px 0" }}>
              <label className="prompt-hints" style={{ gap: 6 }}><MapPin size={13} /><input aria-label="Destination" placeholder="Destination" value={details.destination} onChange={(e) => setDetails({ ...details, destination: e.target.value })} style={{ width: 120, border: 0, outline: 0, background: "transparent", fontSize: 12 }} /></label>
              <label className="prompt-hints" style={{ gap: 6 }}><CalendarDays size={13} /><input aria-label="From date" type="date" value={details.start} onChange={(e) => setDetails({ ...details, start: e.target.value })} style={{ border: 0, outline: 0, background: "transparent", fontSize: 12 }} /><span>to</span><input aria-label="To date" type="date" value={details.end} min={details.start} onChange={(e) => setDetails({ ...details, end: e.target.value })} style={{ border: 0, outline: 0, background: "transparent", fontSize: 12 }} /></label>
              <label className="prompt-hints" style={{ gap: 6 }}><Users size={13} /><input aria-label="Adults" type="number" min={1} max={30} value={details.adults} onChange={(e) => setDetails({ ...details, adults: e.target.value })} style={{ width: 40, border: 0, outline: 0, background: "transparent", fontSize: 12 }} /><span>adults</span><input aria-label="Children" type="number" min={0} max={30} value={details.children} onChange={(e) => setDetails({ ...details, children: e.target.value })} style={{ width: 40, border: 0, outline: 0, background: "transparent", fontSize: 12 }} /><span>children</span></label>
              <label className="prompt-hints" style={{ gap: 6 }}><Wallet size={13} /><input aria-label="Budget" placeholder="Budget (e.g. USD 3000)" value={details.budget} onChange={(e) => setDetails({ ...details, budget: e.target.value })} style={{ width: 150, border: 0, outline: 0, background: "transparent", fontSize: 12 }} /></label>
            </div>
          </section>

            <div className="quick-prompts"><span className="quick-label">NEED A LITTLE INSPIRATION?</span><div className="prompt-chips"><button onClick={() => startTrip("A relaxed beach escape")}>☼ &nbsp;Somewhere by the sea</button><button onClick={() => startTrip("A long weekend in Japan")}>↗ &nbsp;A long weekend away</button><button onClick={() => startTrip("A family trip with the kids")}>♡ &nbsp;A family adventure</button></div></div>

            <section className="destinations-section"><div className="section-title-row"><div><div className="section-kicker">THE WORLD, AT YOUR PACE</div><h2>Places worth getting lost in</h2></div><button className="view-all" onClick={() => { setQuery(""); setActive("Overview"); }}>Explore all <ArrowRight size={15} /></button></div>
              {visibleDestinations.length ? <div className="destination-grid">{visibleDestinations.slice(0, 3).map((d, i) => <DestinationCard key={d.slug} destination={d} index={i} saved={savedSlugs.includes(d.slug)} onSave={() => toggleSaved(d.slug)} onSelect={() => setSelected(d)} />)}</div> : <div className="empty-results"><Search size={20} /><strong>No saved places yet</strong><span>Tap the bookmark on a destination card to keep it here.</span></div>}
              {<div className="demo-note"><span className="demo-dot" /><span><strong>Destination ideas · Demo data</strong> &nbsp;Images and sample budgets are illustrative. No live inventory has been searched.</span><ArrowUpRight size={14} /></div>}
            </section>
            <footer className="page-footer"><span>© 2026 MK Solutions</span><span>Made for memorable journeys <span className="footer-star">✳</span></span><button onClick={() => setActive("Privacy & trust")}>Privacy & trust</button></footer>
          </>}
        </div>}
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
