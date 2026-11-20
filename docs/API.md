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

## Planned supplier boundary

The application currently has no supplier API routes. Once authorized documentation and credentials exist, implement server-only adapters with `search`, `checkAvailability`, `getPricing`, `getDetails`, `createBooking`, `confirmBooking`, `cancelBooking`, `getBookingStatus` and `getVoucher`. Normalize responses to the inventory and booking models in `prisma/schema.prisma`. Persist the source, supplier reference and verification timestamp. Do not add guessed URLs or parameters.
