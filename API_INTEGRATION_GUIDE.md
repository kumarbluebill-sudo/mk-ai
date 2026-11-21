# Supplier API Integration Guide

Rule: endpoints, payloads and booking methods come only from officially provided
documentation. Without docs, we ship the adapter interface, config page and a clearly
labelled sandbox/demo adapter, never mock data presented as live.

## Status

| Supplier | Status | Needed to proceed |
| --- | --- | --- |
| Viator | Integrated (`src/integrations/viator`): activity search, product details, pricing/availability check, booking route | `VIATOR_SANDBOX_KEY` / `VIATOR_PRODUCTION_KEY`; production access requires Viator partner approval |
| Traveldesk (UAE tours) | Integrated, **test API** (`src/integrations/traveldesk`): tour search, per-date availability with seats left and unit prices. Source of truth: `https://testapi.traveldesk.me/swagger/b2bpublic/swagger.json` (Bearer API key). The same spec has `POST /bookings/reserve`, `/bookings/confirm`, `/bookings/cancel`, `GET /balance`, voucher/ticket/invoice downloads: not wired yet | `TRAVELDESK_API_KEY`; set `TRAVELDESK_API_ENV=production` and the production base URL only when Traveldesk gives you production access |
| Yatra | Not implemented | Official API docs, base URL, API credentials, sandbox access |
| Klook | Not implemented | Klook affiliate/partner API docs and credentials |
| Hotelbeds / Amadeus / Sabre / Travelport | Not implemented | Partner agreement, docs, credentials |
| Maps / routing | Not implemented | Provider choice and API key |
| Razorpay | Not implemented | Key id/secret, webhook secret |

## Viator

Env: `VIATOR_API_ENV` (`sandbox` | `production`), `VIATOR_SANDBOX_KEY`, `VIATOR_PRODUCTION_KEY`.

Routes: `/api/viator/activities`, `/api/viator/activities/search`, `/api/viator/pricing`,
`/api/viator/booking`, `/api/viator/init`.
