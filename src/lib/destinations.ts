export type Destination = {
  slug: string;
  name: string;
  country: string;
  region: string;
  tagline: string;
  image: string;
  startingAt: number;
  days: number;
  highlights: string[];
};

// Editorial sample content only. Prices are illustrative and are never presented as live inventory.
export const destinations: Destination[] = [
  { slug: "dubai", name: "Dubai", country: "United Arab Emirates", region: "Middle East", tagline: "Desert horizons, skyline icons and warm nights.", image: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1200&q=85", startingAt: 62900, days: 4, highlights: ["Burj Khalifa", "Desert safari", "Dubai Marina"] },
  { slug: "bali", name: "Bali", country: "Indonesia", region: "Southeast Asia", tagline: "Slow island mornings and emerald landscapes.", image: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1200&q=85", startingAt: 54800, days: 6, highlights: ["Ubud", "Temple visits", "Island beaches"] },
  { slug: "kyoto", name: "Kyoto", country: "Japan", region: "East Asia", tagline: "Quiet lanes, timeless gardens and good tea.", image: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=85", startingAt: 88700, days: 5, highlights: ["Fushimi Inari", "Arashiyama", "Gion"] },
  { slug: "amalfi", name: "Amalfi Coast", country: "Italy", region: "Europe", tagline: "Cliffside villages and long coastal lunches.", image: "https://images.unsplash.com/photo-1533587851505-d119e13fa0d7?auto=format&fit=crop&w=1200&q=85", startingAt: 112000, days: 5, highlights: ["Positano", "Ravello", "Coastal boat ride"] },
  { slug: "jaipur", name: "Jaipur", country: "India", region: "India", tagline: "Pink city courtyards, colour and craft.", image: "https://images.unsplash.com/photo-1599661046827-dacff0c0f09a?auto=format&fit=crop&w=1200&q=85", startingAt: 24900, days: 3, highlights: ["Amber Fort", "City Palace", "Old city markets"] },
  { slug: "santorini", name: "Santorini", country: "Greece", region: "Europe", tagline: "Whitewashed paths above the Aegean blue.", image: "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=1200&q=85", startingAt: 97300, days: 4, highlights: ["Oia sunset", "Caldera walk", "Akrotiri"] },
];

export function searchDestinations(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return destinations;
  return destinations.filter((d) => `${d.name} ${d.country} ${d.region} ${d.highlights.join(" ")}`.toLowerCase().includes(q));
}
