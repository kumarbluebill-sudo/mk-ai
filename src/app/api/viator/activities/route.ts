import { NextRequest, NextResponse } from "next/server";
import { getViatorClient } from "@/integrations/viator/client";

export async function GET(request: NextRequest) {
  try {
    const keyword = request.nextUrl.searchParams.get("keyword") ?? "";
    const destinationId =
      request.nextUrl.searchParams.get("destinationId") ?? "";
    const startDate = request.nextUrl.searchParams.get("startDate") ?? "";
    const currency = request.nextUrl.searchParams.get("currency") ?? "USD";

    if (!keyword && !destinationId) {
      return NextResponse.json(
        { error: "Either keyword or destinationId is required" },
        { status: 400 }
      );
    }

    const client = getViatorClient();
    const results = await client.searchActivities({
      keyword: keyword || undefined,
      destinationId: destinationId || undefined,
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
      { status: 500 }
    );
  }
}
