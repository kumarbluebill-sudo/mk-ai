# API notes

## `GET /api/destinations?q=<query>`

Searches the local, editorial demonstration catalogue. `q` is optional; when omitted, the full catalogue is returned.

Example response:

```json
{
  "source": "DEMO DATA",
  "liveInventory": false,
  "results": [
    {
      "slug": "dubai",
      "name": "Dubai",
      "country": "United Arab Emirates",
      "region": "Middle East",
      "tagline": "Desert horizons, skyline icons and warm nights.",
      "image": "https://images.unsplash.com/...",
      "startingAt": 62900,
      "days": 4,
      "highlights": ["Burj Khalifa", "Desert safari", "Dubai Marina"]
    }
  ]
}
```

The sample `startingAt` value is an illustrative planning hint, not a quote. This endpoint does not call Yatra, Klook or a destination supplier and must not be used to confirm inventory.

## `GET /api/viator/activities`

Searches live Viator products using Partner API v2 free-text search. `keyword` is required; `startDate` is optional and must be `YYYY-MM-DD`; `currency` defaults to `USD`.

The API key is read by the server from `VIATOR_SANDBOX_KEY` or `VIATOR_PRODUCTION_KEY`, selected by `VIATOR_API_ENV`. Search prices are not final; use the availability check below for the selected travel date and traveler mix.

## `POST /api/viator/pricing`

Checks live Viator availability and pricing for one activity. This returns the available start times and the Viator-recommended retail price for the selected traveler mix.

```json
{
  "activityId": "163605P4",
  "date": "2026-12-15",
  "adults": 2,
  "children": 0,
  "currency": "USD"
}
```

Only Viator activities are priced. Hotels, flights, transfers, and complete trip totals are not included. An empty `bookableItems` array means Viator returned no bookable price for the requested date and traveler mix.

Viator booking, payments and other suppliers are not implemented. Future suppliers require authorized documentation and credentials; implement server-only adapters and do not guess supplier URLs or parameters.
