import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * Quick Package Builder - NO DATABASE REQUIRED
 * Returns an ESTIMATE based on demo rate tables (not live supplier prices).
 */

const quickPackageSchema = z.object({
  destination: z.string().min(1).default("bali"),
  travelers: z
    .object({
      adults: z.number().int().min(1).default(2),
      children: z.number().int().min(0).default(0),
    })
    .default({ adults: 2, children: 0 }),
  startDate: z.string().default("2026-12-15"),
  endDate: z.string().default("2026-12-20"),
  tripType: z.string().default("customized"),
  activities: z.array(z.string()).min(1).default(["culture", "adventure"]),
  accommodation: z.string().default("midrange"),
  transport: z.string().default("private"),
});

interface ItineraryItem {
  day: number;
  date: string;
  title: string;
  type: "activity" | "accommodation" | "transport";
  price: string;
  currency: string;
}

export async function POST(request: NextRequest) {
  try {
    const parsed = quickPackageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const {
      destination,
      travelers,
      startDate,
      endDate,
      tripType,
      activities,
      accommodation,
      transport,
    } = parsed.data;

    // Calculate days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (!Number.isFinite(days) || days < 1) {
      return NextResponse.json(
        { success: false, error: "endDate must be after startDate" },
        { status: 400 }
      );
    }

    // Calculate pricing
    const pricing = {
      activities: calculateActivityPrice(activities, destination, days, travelers.adults),
      accommodation: calculateAccommodationPrice(accommodation, days, travelers.adults),
      transport: calculateTransportPrice(transport, days, travelers.adults),
    };

    const subtotal =
      pricing.activities + pricing.accommodation + pricing.transport;
    const taxes = Math.round(subtotal * 0.1 * 100) / 100;
    const markup = Math.round(subtotal * 0.15 * 100) / 100;
    const total = Math.round((subtotal + taxes + markup) * 100) / 100;

    // Build itinerary items
    const itineraryItems: ItineraryItem[] = [];
    for (let i = 0; i < days; i++) {
      const dayDate = new Date(start);
      dayDate.setDate(dayDate.getDate() + i);

      // Activity
      const activity = activities[i % activities.length];
      itineraryItems.push({
        day: i + 1,
        date: dayDate.toISOString().split("T")[0],
        title: capitalizeActivity(activity),
        type: "activity",
        price: (pricing.activities / days).toFixed(2),
        currency: "USD",
      });

      // Accommodation
      itineraryItems.push({
        day: i + 1,
        date: dayDate.toISOString().split("T")[0],
        title: `${capitalizeAccommodation(accommodation)} Accommodation`,
        type: "accommodation",
        price: (pricing.accommodation / days).toFixed(2),
        currency: "USD",
      });

      // Transport
      itineraryItems.push({
        day: i + 1,
        date: dayDate.toISOString().split("T")[0],
        title: "Transfer",
        type: "transport",
        price: (pricing.transport / days).toFixed(2),
        currency: "USD",
      });
    }

    const response = {
      success: true,
      // Hardcoded demo rate tables - NOT live supplier inventory.
      isEstimate: true,
      source: "demo-rate-table",
      package: {
        reference: `PKG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        title: `${capitalizeDestination(destination)} Trip - ${travelers.adults} traveler${travelers.adults > 1 ? "s" : ""}`,
        destination: capitalizeDestination(destination),
        summary: {
          destination: capitalizeDestination(destination),
          travelers: `${travelers.adults} adult${travelers.adults > 1 ? "s" : ""}${travelers.children ? `, ${travelers.children} children` : ""}`,
          dates: `${startDate} to ${endDate}`,
          tripType: tripType,
          activities: activities.map((a: string) => capitalizeActivity(a)),
          accommodation: capitalizeAccommodation(accommodation),
          transport: transport,
          totalDays: days,
        },
        pricing: {
          activities: pricing.activities,
          accommodation: pricing.accommodation,
          transport: pricing.transport,
          subtotal: subtotal,
          taxes: taxes,
          markup: markup,
          total: total,
          currency: "USD",
        },
        itinerary: itineraryItems,
        breakdown: {
          "Activities": `$${pricing.activities} (${activities.join(", ")})`,
          "Accommodation": `$${pricing.accommodation} (${days} nights)`,
          "Transport": `$${pricing.transport} (${transport} transfers)`,
          "Subtotal": `$${subtotal}`,
          "Tax (10%)": `$${taxes}`,
          "Markup (15%)": `$${markup}`,
          "TOTAL": `$${total}`,
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Package creation error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create package",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Pricing functions
function calculateActivityPrice(
  activities: string[],
  destination: string,
  days: number,
  adults: number
): number {
  const baseRates: { [key: string]: number } = {
    adventure: 85,
    culture: 65,
    relaxation: 95,
    food: 75,
    nature: 60,
    beach: 50,
    hiking: 55,
    museum: 40,
  };

  const multipliers: { [key: string]: number } = {
    dubai: 1.5,
    bali: 0.8,
    kyoto: 1.2,
    paris: 1.4,
    tokyo: 1.3,
    thailand: 0.9,
    maldives: 1.6,
  };

  const basePrice = activities.reduce((sum: number, activity: string) => {
    return sum + (baseRates[activity.toLowerCase()] || 70);
  }, 0);

  const multiplier = multipliers[destination.toLowerCase()] || 1;
  return Math.round(basePrice * multiplier * days * adults * 100) / 100;
}

function calculateAccommodationPrice(
  level: string,
  nights: number,
  adults: number
): number {
  const rates: { [key: string]: number } = {
    budget: 50,
    midrange: 120,
    luxury: 300,
  };
  return (rates[level.toLowerCase()] || 100) * nights * adults;
}

function calculateTransportPrice(
  type: string,
  days: number,
  adults: number
): number {
  const rate = type === "private" ? 40 : 10;
  return rate * days * adults;
}

function capitalizeActivity(activity: string): string {
  const titles: { [key: string]: string } = {
    adventure: "Adventure Activity",
    culture: "Cultural Experience",
    relaxation: "Relaxation & Wellness",
    food: "Food Tour",
    nature: "Nature Exploration",
    beach: "Beach Day",
    hiking: "Hiking Expedition",
    museum: "Museum Visit",
    shopping: "Shopping Experience",
  };
  return titles[activity.toLowerCase()] || activity;
}

function capitalizeAccommodation(level: string): string {
  const titles: { [key: string]: string } = {
    budget: "Budget Hotel",
    midrange: "Mid-Range Hotel",
    luxury: "Luxury Resort",
  };
  return titles[level.toLowerCase()] || level;
}

function capitalizeDestination(dest: string): string {
  return dest.charAt(0).toUpperCase() + dest.slice(1);
}
