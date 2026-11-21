import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/server/audit";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireTenantContext("booking:create");
    const body = await request.json();
    const {
      activityId,
      title,
      date,
      participants,
      price,
      currency,
      customerEmail,
      customerName,
    } = body;

    if (!activityId || !date || !participants || !price) {
      return NextResponse.json(
        {
          error: "Missing required fields: activityId, date, participants, price",
        },
        { status: 400 }
      );
    }

    const prisma = ctx.db;
    const customer = await prisma.customer.findFirst({ where: { userId: ctx.userId } });
    if (!customer) {
      return NextResponse.json({ error: "Customer profile not found" }, { status: 409 });
    }

    // Create a DRAFT booking record. This does NOT reserve anything with Viator.
    const booking = await prisma.booking.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: customer.id,
        reference: `VTR-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        status: "DRAFT",
        total: price,
        currency,
        items: {
          create: {
            status: "DRAFT",
            // supplierReference stays empty until the supplier returns a real booking reference.
            details: {
              productCode: activityId,
              title,
              date,
              participants,
              price,
              currency,
            },
          },
        },
      },
      include: {
        items: true,
      },
    });

    void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.draft_created", entity: "Booking", entityId: booking.id });

    return NextResponse.json({
      success: true,
      message: "Booking created successfully",
      booking: {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        total: booking.total,
        currency: booking.currency,
        items: booking.items,
        nextStep:
          "Review and confirm your booking details. Payment will be processed upon confirmation.",
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Booking error:", error);
    return NextResponse.json(
      {
        error: "Failed to create booking",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireTenantContext("booking:read");
    const bookingId = request.nextUrl.searchParams.get("id") ?? "";

    if (!bookingId) {
      return NextResponse.json(
        { error: "Booking ID is required" },
        { status: 400 }
      );
    }

    const booking = await ctx.db.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: true,
        payments: true,
        vouchers: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      booking,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Booking fetch error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch booking",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Only these transitions may be requested by a client. CONFIRMED / PARTIALLY_CONFIRMED /
// REFUNDED can only be set by server code after a real supplier or payment confirmation.
const CLIENT_SETTABLE_STATUSES = new Set(["AWAITING_APPROVAL", "CANCELLED"]);

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireTenantContext("booking:create");
    const body = await request.json();
    const { bookingId, status, paymentDetails } = body;

    if (!bookingId || !status) {
      return NextResponse.json(
        { error: "bookingId and status are required" },
        { status: 400 }
      );
    }

    if (!CLIENT_SETTABLE_STATUSES.has(status)) {
      return NextResponse.json(
        { error: `Status ${status} cannot be set directly` },
        { status: 400 }
      );
    }

    const updatedBooking = await ctx.db.booking.update({
      where: { id: bookingId },
      data: {
        status,
      },
      include: {
        items: true,
        payments: true,
      },
    });

    void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "booking.status_changed", entity: "Booking", entityId: bookingId, metadata: { status } });

    return NextResponse.json({
      success: true,
      message: `Booking status updated to ${status}`,
      booking: updatedBooking,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("Booking update error:", error);
    return NextResponse.json(
      {
        error: "Failed to update booking",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
