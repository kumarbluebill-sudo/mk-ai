import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Itinerary model held in the conversation state. Patches touch only the days /
 * items they name, so "change day 2" never regenerates the rest of the trip.
 */

export const ITEM_CATEGORIES = [
  "flight",
  "arrival",
  "departure",
  "hotel",
  "checkin",
  "restaurant",
  "breakfast",
  "sightseeing",
  "museum",
  "adventure",
  "beach",
  "cruise",
  "shopping",
  "transfer",
  "bus",
  "train",
  "walking",
  "free_time",
  "theme_park",
  "other",
] as const;

/** How trustworthy an item's data is. Only LIVE items came from a supplier availability check. */
export const ITEM_STATUSES = ["LIVE", "ESTIMATE", "UNVERIFIED"] as const;

export const itemInputSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(ITEM_CATEGORIES).default("other"),
  description: z.string().max(1000).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  location: z.string().max(200).optional(),
  supplier: z.string().max(60).optional(),
  productCode: z.string().max(100).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(ITEM_STATUSES).default("UNVERIFIED"),
});

export type ItemInput = z.infer<typeof itemInputSchema>;
export interface ItineraryItem extends ItemInput {
  id: string;
}

export interface ItineraryDay {
  dayNumber: number;
  date?: string;
  title: string;
  items: ItineraryItem[];
}

export interface Itinerary {
  title: string;
  destination: string;
  startDate?: string;
  days: ItineraryDay[];
}

export class ItineraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItineraryError";
  }
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function newItem(input: ItemInput): ItineraryItem {
  return { ...input, id: randomUUID() };
}

export const createItinerarySchema = z.object({
  title: z.string().min(1).max(200),
  destination: z.string().min(1).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z
    .array(z.object({ title: z.string().min(1).max(200), items: z.array(itemInputSchema).default([]) }))
    .min(1)
    .max(30),
});

export function createItinerary(input: z.infer<typeof createItinerarySchema>): Itinerary {
  return {
    title: input.title,
    destination: input.destination,
    startDate: input.startDate,
    days: input.days.map((d, i) => ({
      dayNumber: i + 1,
      date: input.startDate ? addDays(input.startDate, i) : undefined,
      title: d.title,
      items: d.items.map(newItem),
    })),
  };
}

export const patchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_item"), day: z.number().int().min(1), item: itemInputSchema }),
  z.object({ op: z.literal("remove_item"), itemId: z.string().min(1) }),
  z.object({ op: z.literal("replace_item"), itemId: z.string().min(1), item: itemInputSchema }),
  z.object({ op: z.literal("set_day_title"), day: z.number().int().min(1), title: z.string().min(1).max(200) }),
  z.object({ op: z.literal("add_day"), title: z.string().min(1).max(200) }),
  z.object({ op: z.literal("remove_day"), day: z.number().int().min(1) }),
]);

export type ItineraryPatch = z.infer<typeof patchSchema>;

function renumber(it: Itinerary): Itinerary {
  return {
    ...it,
    days: it.days.map((d, i) => ({
      ...d,
      dayNumber: i + 1,
      date: it.startDate ? addDays(it.startDate, i) : d.date,
    })),
  };
}

function findItem(it: Itinerary, itemId: string) {
  for (const d of it.days) {
    const idx = d.items.findIndex((x) => x.id === itemId);
    if (idx >= 0) return { day: d, idx };
  }
  throw new ItineraryError(`Item ${itemId} not found`);
}

/** Pure: returns a new itinerary with only the targeted part changed. */
export function applyPatch(it: Itinerary, patch: ItineraryPatch): Itinerary {
  switch (patch.op) {
    case "add_item": {
      if (!it.days.some((d) => d.dayNumber === patch.day)) throw new ItineraryError(`Day ${patch.day} not found`);
      return {
        ...it,
        days: it.days.map((d) => (d.dayNumber === patch.day ? { ...d, items: [...d.items, newItem(patch.item)] } : d)),
      };
    }
    case "remove_item": {
      const { day } = findItem(it, patch.itemId);
      return {
        ...it,
        days: it.days.map((d) => (d === day ? { ...d, items: d.items.filter((x) => x.id !== patch.itemId) } : d)),
      };
    }
    case "replace_item": {
      const { day, idx } = findItem(it, patch.itemId);
      return {
        ...it,
        days: it.days.map((d) =>
          d === day ? { ...d, items: d.items.map((x, i) => (i === idx ? { ...patch.item, id: x.id } : x)) } : d
        ),
      };
    }
    case "set_day_title": {
      if (!it.days.some((d) => d.dayNumber === patch.day)) throw new ItineraryError(`Day ${patch.day} not found`);
      return { ...it, days: it.days.map((d) => (d.dayNumber === patch.day ? { ...d, title: patch.title } : d)) };
    }
    case "add_day":
      return renumber({ ...it, days: [...it.days, { dayNumber: it.days.length + 1, title: patch.title, items: [] }] });
    case "remove_day": {
      if (it.days.length === 1) throw new ItineraryError("Cannot remove the only day");
      if (!it.days.some((d) => d.dayNumber === patch.day)) throw new ItineraryError(`Day ${patch.day} not found`);
      return renumber({ ...it, days: it.days.filter((d) => d.dayNumber !== patch.day) });
    }
  }
}
