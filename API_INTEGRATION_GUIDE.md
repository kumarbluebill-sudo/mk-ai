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


## FreeLLMAPI (AI provider)

An OpenAI-compatible gateway the chat assistant can use instead of (or before) Anthropic/OpenAI.

1. Start FreeLLMAPI on the same computer (server version: `http://localhost:3001/v1`; the Windows desktop app listens on `http://127.0.0.1:31415/v1`, so set the base URL to match) and create an API key in it.
2. Local development: put `FREELLMAPI_API_KEY="..."` in `.env.local` and set `AI_PROVIDER=freellmapi`, or open **/admin/ai** (platform admin) and fill in FreeLLMAPI: base URL, key, model (`auto` or a model from **Load models**), then **Test connection**.
3. A successful test shows "Connection successful" with the number of models listed and which model answered. Any other message names the cause (authentication, server unavailable, invalid model, rate limit, timeout).
4. Order and fallback: the first enabled provider is the primary. Tick "use as a fallback" on others you want to run when it fails; leave it off to guarantee they never run behind it.
5. **The live site cannot reach `localhost`.** For Vercel, FreeLLMAPI needs a public `https` address; until then leave it disabled there.

Manual check that has not been run yet (needs the real service): Test connection; Load models; a multi-turn chat; a request that makes the assistant call a tool and build an itinerary; stop the gateway and confirm the clear error (and the fallback, if one is allowed).
