# Development Plan

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Codebase audit, docs, build fix | Done |
| 2 | Foundation: tenancy schema, Auth.js, tenant isolation, encryption, Docker, CI, tests | Done, except Redis client and DB-backed tests |
| 3 | AI engine: provider adapters (Anthropic/OpenAI), tool registry, agent loop, step-level streaming chat | Done for 9 of 20 tools; the rest return NOT_CONFIGURED. Token-level streaming not done |
| 4 | Supplier adapter framework, parallel live search, availability verification | **Framework and parallel search done** (Viator only). Availability verification across suppliers and a second real supplier need official docs/credentials |
| 5 | Day-wise itinerary designer, icons, drag-and-drop, maps/routing | Next cycle |
| 6 | Pricing/markup/GST engine, branded PDFs | Next cycle |
| 7 | Booking, Razorpay payments, webhooks, vouchers | Next cycle |
| 8 | Subscriptions, usage limits, tenant dashboard, super admin | Later |
| 9 | PWA (service worker), Capacitor Android | Later |
| 10 | E2E tests, staging/production deployment | Later |

## Blocked on external requirements

- **Yatra, Klook, Hotelbeds, Amadeus, Sabre, Travelport:** need official API
  documentation and credentials. Adapters will not be written against guessed endpoints.
- **Maps/routing:** needs a provider choice and API key (e.g. Google Maps, Mapbox).
- **Razorpay:** needs merchant keys and webhook secret.
- **Email/WhatsApp:** need authorised provider accounts.
