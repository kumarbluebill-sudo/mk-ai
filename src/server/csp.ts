/**
 * Content-Security-Policy with a per-request nonce for scripts. Next.js reads the nonce from the request's
 * CSP header and stamps it on its own scripts; 'strict-dynamic' lets those scripts load their chunks.
 * Injected inline scripts have no nonce, so the browser refuses them.
 */
export function buildCsp(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Styles stay inline: React style attributes and component libraries use them everywhere, and style
    // injection cannot run code the way script injection can.
    "style-src 'self' 'unsafe-inline'",
    // Supplier photos (Viator, Traveldesk) come from CDN hosts that change, so any https image is allowed; images cannot run code.
    // Mapbox and OpenStreetMap tiles are covered by the same rule.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.mapbox.com https://events.mapbox.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
