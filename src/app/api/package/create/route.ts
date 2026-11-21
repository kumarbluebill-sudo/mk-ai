import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";
import type { ConversationState } from "@/lib/conversation-flow";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireTenantContext("itinerary:write");
    const body = await request.json() as ConversationState;
    const {
      destination,
      travelers,
      startDate,
      endDate,
      tripType,
      activities,
      accommodation,
      transport,
    } = body;

    if (!destination || !travelers || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Tenant-scoped client: itinerary/quotation rows are stamped with the caller's tenant.
    const prisma = ctx.db;
    const customer = await prisma.customer.findFirst({ where: { userId: ctx.userId } });
    if (!customer) {
      return NextResponse.json({ error: "Customer profile not found" }, { status: 409 });
    }

    // Create itinerary
    const itinerary = await prisma.itinerary.create({
      data: {
        tenantId: ctx.tenantId,
        title: `${destination.charAt(0).toUpperCase() + destination.slice(1)} Trip - ${travelers.adults} traveler${travelers.adults > 1 ? "s" : ""}`,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: "DRAFT",
      },
    });

    // Calculate number of days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Create itinerary days
    const itineraryDays = [];
    let totalPrice = 0;
    const items = [];

    for (let i = 0; i < days; i++) {
      const dayDate = new Date(start);
      dayDate.setDate(dayDate.getDate() + i);

      const day = await prisma.itineraryDay.create({
        data: {
          itineraryId: itinerary.id,
          dayNumber: i + 1,
          date: dayDate,
          title: `Day ${i + 1} in ${destination}`,
        },
      });

      itineraryDays.push(day);

      // Create itinerary items for activities
      if (activities && activities.length > 0) {
        const activity = activities[i % activities.length];
        const basePrice = calculateActivityPrice(activity, destination);
        const totalActivityPrice = basePrice * travelers.adults;

        const item = await prisma.itineraryItem.create({
          data: {
            dayId: day.id,
            title: capitalizeActivity(activity),
            description: `Enjoy ${activity} experience in ${destination}`,
            supplierName: "ESTIMATE",
            liveStatus: "DEMO",
            price: basePrice,
            currency: "USD",
            metadata: {
              activity,
              destination,
              tripType,
            },
          },
        });

        items.push(item);
        totalPrice += totalActivityPrice;
      }

      // Add accommodation
      if (accommodation) {
        const accommodationPrice = calculateAccommodationPrice(
          accommodation,
          travelers.adults
        );

        const accItem = await prisma.itineraryItem.create({
          data: {
            dayId: day.id,
            title: `${capitalizeAccommodation(accommodation)} Accommodation`,
            supplierName: "ESTIMATE",
            liveStatus: "DEMO",
            price: accommodationPrice,
            currency: "USD",
            metadata: {
              accommodation,
              nights: 1,
            },
          },
        });

        items.push(accItem);
        totalPrice += accommodationPrice;
      }

      // Add transport if private
      if (transport === "private" || transport === "both") {
        const transportPrice = calculateTransportPrice(
          "private",
          travelers.adults
        );

        const transportItem = await prisma.itineraryItem.create({
          data: {
            dayId: day.id,
            title: "Private Transfer",
            supplierName: "ESTIMATE",
            liveStatus: "DEMO",
            price: transportPrice,
            currency: "USD",
            metadata: {
              transport: "private",
            },
          },
        });

        items.push(transportItem);
        totalPrice += transportPrice;
      }
    }

    // Create quotation
    const quotation = await prisma.quotation.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: customer.id,
        itineraryId: itinerary.id,
        reference: `PKG-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        status: "DRAFT",
        currency: "USD",
        subtotal: totalPrice,
        taxes: Math.round(totalPrice * 0.1 * 100) / 100, // 10% tax
        markup: Math.round(totalPrice * 0.15 * 100) / 100, // 15% markup
        total:
          Math.round(
            (totalPrice +
              Math.round(totalPrice * 0.1 * 100) / 100 +
              Math.round(totalPrice * 0.15 * 100) / 100) *
              100
          ) / 100,
      },
    });

    return NextResponse.json({
      success: true,
      package: {
        itinerary,
        quotation,
        items,
        summary: {
          destination,
          travelers,
          dates: `${startDate} to ${endDate}`,
          tripType,
          activities,
          accommodation,
          transport,
          totalDays: days,
          totalPrice: quotation.total,
          currency: quotation.currency,
        },
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Package creation error:", error);
    return NextResponse.json(
      {
        error: "Failed to create package",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Helper functions for pricing
function calculateActivityPrice(activity: string, destination: string): number {
  const baseRates: { [key: string]: number } = {
    adventure: 85,
    culture: 65,
    relaxation: 95,
    food: 75,
    nature: 60,
    beach: 50,
    hiking: 55,
    museum: 40,
    shopping: 0,
  };

  const rate = baseRates[activity.toLowerCase()] || 70;

  // Destination multipliers
  const multipliers: { [key: string]: number } = {
    dubai: 1.5,
    bali: 0.8,
    kyoto: 1.2,
    paris: 1.4,
    tokyo: 1.3,
  };

  return (baseRates[activity.toLowerCase()] || 70) * (multipliers[destination.toLowerCase()] || 1);
}

function calculateAccommodationPrice(
  level: string,
  travelers: number
): number {
  const rates: { [key: string]: number } = {
    budget: 50,
    midrange: 120,
    luxury: 300,
  };
  return (rates[level.toLowerCase()] || 100) * travelers;
}

function calculateTransportPrice(type: string, travelers: number): number {
  if (type === "private") {
    return 40 * travelers;
  }
  return 10 * travelers;
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
