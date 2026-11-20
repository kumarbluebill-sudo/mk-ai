import { NextRequest, NextResponse } from "next/server";
import { getViatorClient } from "@/integrations/viator/client";

export async function GET(request: NextRequest) {
  try {
    const activityId = request.nextUrl.searchParams.get("activityId") ?? "";
    const date = request.nextUrl.searchParams.get("date") ?? "";
    const participants =
      parseInt(request.nextUrl.searchParams.get("participants") ?? "1") || 1;

    if (!activityId) {
      return NextResponse.json(
        { error: "activityId is required" },
        { status: 400 }
      );
    }

    const client = getViatorClient();
    const activity = await client.getActivityDetails(activityId);

    return NextResponse.json({
      success: true,
      activityId,
      title: activity.title,
      pricing: {
        basePrice: activity.price,
        currency: activity.currency,
        participants,
        totalPrice: activity.price * participants,
        cancellationPolicy: activity.cancellationPolicy,
      },
      availability: date
        ? await client.checkAvailability(activityId, date, participants)
        : null,
    });
  } catch (error) {
    console.error("VIATOR pricing error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch pricing",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
