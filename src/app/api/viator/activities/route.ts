import { NextRequest, NextResponse } from "next/server";
import { getViatorClient } from "@/integrations/viator/client";

export async function GET(request: NextRequest) {
  try {
    const keyword = request.nextUrl.searchParams.get("keyword") ?? "";
    const startDate = request.nextUrl.searchParams.get("startDate") ?? "";
    const currency = request.nextUrl.searchParams.get("currency") ?? "USD";

    if (!keyword.trim()) {
      return NextResponse.json(
        { error: "keyword is required" },
        { status: 400 }
      );
    }
    if (keyword.length > 200) {
      return NextResponse.json(
        { error: "keyword must be 200 characters or fewer" },
        { status: 400 }
      );
    }
    if (startDate && !isValidDate(startDate)) {
      return NextResponse.json(
        { error: "startDate must be a valid YYYY-MM-DD date" },
        { status: 400 }
      );
    }
    if (!["USD", "EUR", "GBP", "AUD", "CAD"].includes(currency)) {
      return NextResponse.json(
        { error: "currency must be USD, EUR, GBP, AUD, or CAD" },
        { status: 400 }
      );
    }

    const client = getViatorClient();
    const results = await client.searchActivities({
      keyword,
      startDate: startDate || undefined,
      currency,
    });

    return NextResponse.json({
      source: "VIATOR",
      environment: client.getEnvironment(),
      liveInventory: true,
      ...results,
    });
  } catch (error) {
    console.error("VIATOR search error:", error);
    return NextResponse.json(
      {
        error: "Failed to search activities",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
