import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient, disconnectPrisma } from "@/lib/prisma";
import { getViatorService } from "@/integrations/viator/service";

export async function GET(request: NextRequest) {
  try {
    const keyword = request.nextUrl.searchParams.get("keyword") ?? "";
    const destinationId =
      request.nextUrl.searchParams.get("destinationId") ?? "";
    const storeResults =
      request.nextUrl.searchParams.get("store") === "true";

    if (!keyword && !destinationId) {
      return NextResponse.json(
        { error: "Either keyword or destinationId is required" },
        { status: 400 }
      );
    }

    const prisma = getPrismaClient();
    const service = getViatorService(prisma);

    if (storeResults) {
      const result = await service.searchAndStoreActivities(
        keyword,
        destinationId || undefined
      );

      return NextResponse.json({
        success: true,
        message: "Activities searched and stored in database",
        ...result,
      });
    } else {
      const stored = await service.getStoredActivities(20);

      return NextResponse.json({
        success: true,
        source: "VIATOR (Database)",
        ...stored,
      });
    }
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
