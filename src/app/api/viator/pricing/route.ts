import { NextRequest, NextResponse } from "next/server";
import { guardRoute } from "@/server/tenant-context";
import { getViatorClient } from "@/integrations/viator/client";

type QuoteInput = {
  activityId: string;
  date: string;
  adults: number;
  children: number;
  currency: string;
  productOptionCode?: string;
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const participants = parseCount(searchParams.get("participants")) ?? 1;
  return getQuote({
    activityId: searchParams.get("activityId") ?? "",
    date: searchParams.get("date") ?? "",
    adults: parseCount(searchParams.get("adults")) ?? participants,
    children: parseCount(searchParams.get("children")) ?? 0,
    currency: searchParams.get("currency") ?? "USD",
    productOptionCode: searchParams.get("productOptionCode") ?? undefined,
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  const adults = parseCount(values.adults);
  const children = parseCount(values.children);
  if (values.adults !== undefined && adults === undefined) {
    return NextResponse.json(
      { error: "adults must be a whole number" },
      { status: 400 }
    );
  }
  if (values.children !== undefined && children === undefined) {
    return NextResponse.json(
      { error: "children must be a whole number" },
      { status: 400 }
    );
  }

  return getQuote({
    activityId: typeof values.activityId === "string" ? values.activityId : "",
    date: typeof values.date === "string" ? values.date : "",
    adults: adults === undefined ? 2 : adults,
    children: children === undefined ? 0 : children,
    currency: typeof values.currency === "string" ? values.currency : "USD",
    productOptionCode:
      typeof values.productOptionCode === "string"
        ? values.productOptionCode
        : undefined,
  });
}

async function getQuote(input: QuoteInput) {
  const denied = await guardRoute("chat:use");
  if (denied) return denied;
  const { activityId, date, adults, children, currency, productOptionCode } = input;

  if (!activityId.trim()) {
    return NextResponse.json({ error: "activityId is required" }, { status: 400 });
  }
  if (!isValidDate(date)) {
    return NextResponse.json(
      { error: "date must be a valid YYYY-MM-DD date" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 15) {
    return NextResponse.json(
      { error: "adults must be an integer from 1 to 15" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(children) || children < 0 || adults + children > 15) {
    return NextResponse.json(
      { error: "traveler count must be between 1 and 15" },
      { status: 400 }
    );
  }
  if (!["USD", "EUR", "GBP", "AUD", "CAD"].includes(currency)) {
    return NextResponse.json(
      { error: "currency must be USD, EUR, GBP, AUD, or CAD" },
      { status: 400 }
    );
  }

  try {
    const client = getViatorClient();
    const { activity, availability } = await client.checkAvailability(
      activityId,
      date,
      { adults, children },
      currency,
      productOptionCode
    );

    return NextResponse.json({
      success: true,
      source: "VIATOR",
      environment: client.getEnvironment(),
      // Sandbox responses are test data, not sellable live inventory.
      liveInventory: client.getEnvironment() === "production",
      checkedAt: new Date().toISOString(),
      activity: {
        id: activity.id,
        title: activity.title,
      },
      travelers: { adults, children },
      ...availability,
      bookableItems: availability.bookableItems.map((item) => ({
        productOptionCode: item.productOptionCode,
        startTime: item.startTime,
        available: item.available,
        price: item.totalPrice?.price?.recommendedRetailPrice ?? null,
        currency: availability.currency,
      })),
    });
  } catch (error) {
    console.error("VIATOR pricing error:", error);
    return NextResponse.json(
      {
        error: "Failed to check live availability and pricing",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}

function parseCount(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : undefined;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
