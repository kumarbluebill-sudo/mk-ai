import { NextRequest, NextResponse } from "next/server";
import { guardRoute } from "@/server/tenant-context";
import { getPrismaClient } from "@/lib/prisma";
import { getViatorService } from "@/integrations/viator/service";

export async function POST(request: NextRequest) {
  const denied = await guardRoute("supplier:manage");
  if (denied) return denied;
  try {
    const prisma = getPrismaClient();
    const service = getViatorService(prisma);

    // Initialize VIATOR supplier in database
    const supplier = await service.initializeSupplier();

    return NextResponse.json({
      success: true,
      message: "VIATOR supplier initialized successfully",
      supplier: {
        id: supplier.id,
        type: supplier.type,
        name: supplier.name,
        enabled: supplier.enabled,
        config: supplier.config,
      },
    });
  } catch (error) {
    console.error("VIATOR initialization error:", error);
    return NextResponse.json(
      {
        error: "Failed to initialize VIATOR supplier",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const denied = await guardRoute("supplier:manage");
  if (denied) return denied;
  try {
    const prisma = getPrismaClient();
    const service = getViatorService(prisma);
    const stored = await service.getStoredActivities(10);

    return NextResponse.json({
      success: true,
      message: "VIATOR supplier status",
      stored,
    });
  } catch (error) {
    console.error("VIATOR status error:", error);
    return NextResponse.json(
      {
        error: "Failed to get VIATOR status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
