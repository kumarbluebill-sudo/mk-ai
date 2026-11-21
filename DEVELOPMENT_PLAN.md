# Development Plan

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Codebase audit, docs, build fix | Done |
| 2 | Foundation: tenancy schema, Auth.js, tenant isolation, encryption, Docker, CI, tests | Done, except Redis client and DB-backed tests |
| 3 | AI engine: provider adapters (Anthropic/OpenAI), tool registry, agent loop, step-level streaming chat | Done for 9 of 20 tools; the rest return NOT_CONFIGURED. Token-level streaming not done |
| 4 | Supplier adapter framework, parallel live search, availability verification | **Framework and parallel search done** (Viator only). Availability verification across suppliers and a second real supplier need official docs/credentials |
| 5 | Day-wise itinerary designer, icons, drag-and-drop, maps/routing | **Done except polish**: manual designer, Mapbox map, place search, real driving legs. Not done: drag-and-drop, category icons, Mapbox-based stop ordering (Optimise order is straight-line), walking/transit legs. Mapbox search results: check your plan's terms before keeping coordinates long-term |
| 6 | Pricing/markup/GST engine, branded PDFs | **Done (basics)**: GST split, immutable snapshot, customer PDF. Not done: Unicode fonts (rupee sign, Indian scripts), logo and bank details on the PDF, quotation edit/versioning/status workflow, sending by email/WhatsApp, TCS rules (need an accountant's input), per-supplier markup rules UI |
| 7 | Booking, Razorpay payments, webhooks, vouchers | **Half done**: Traveldesk reserve/confirm/cancel/voucher against the test API. Not done: Razorpay and customer payment collection (the agency fronts the supplier cost today), webhooks, our own branded voucher, booking from a quotation/itinerary, notifications. Before going live: confirm with Traveldesk what status `PendingVerification` means after confirm, and get production access |
| 8 | Subscriptions, usage limits, tenant dashboard, super admin | Later |
| 9 | PWA (service worker), Capacitor Android | Later |
| 10 | E2E tests, staging/production deployment | Later |

## Blocked on external requirements

- **Yatra, Klook, Hotelbeds, Amadeus, Sabre, Travelport:** need official API
  documentation and credentials. Adapters will not be written against guessed endpoints.
- **Maps/routing:** needs a provider choice and API key (e.g. Google Maps, Mapbox).
- **Razorpay:** needs merchant keys and webhook secret.
- **Email/WhatsApp:** need authorised provider accounts.
