import type { NextConfig } from "next";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  // Google Fonts are loaded by globals.css (self-hosting them with next/font would remove this dependency).
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Map tiles (Mapbox, OpenStreetMap fallback) and supplier images (Traveldesk blob storage).
  "img-src 'self' data: blob: https://api.mapbox.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.blob.core.windows.net",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Docker builds set BUILD_STANDALONE=1; Vercel builds are unaffected.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  async headers() {
    return [
      {
        // The service worker must never be served from a stale cache, or updates would never reach users.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          // Report-only: browsers log what WOULD be blocked, nothing breaks. Next.js inline scripts need
          // 'unsafe-inline' until nonces are added (see SECURITY_GUIDE.md), so this is a floor, not a seal.
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
