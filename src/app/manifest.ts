import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MK AI Travel",
    short_name: "MK Travel",
    description: "AI travel planning, quotations and bookings for travel agencies, by MK Solutions.",
    lang: "en",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f7f4",
    theme_color: "#173d35",
    categories: ["travel", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Plan a trip", short_name: "Chat", url: "/chat", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My trips", short_name: "Trips", url: "/designer", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Bookings", short_name: "Bookings", url: "/bookings", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
