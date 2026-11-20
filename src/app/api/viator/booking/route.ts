import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
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

    const prisma = getPrismaClient();

    // Create booking record
    const booking = await prisma.booking.create({
      data: {
        customerId: "demo", // In production, link to actual customer
        reference: `VTR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: "DRAFT",
        total: price,
        currency,
        items: {
          create: {
            status: "DRAFT",
            supplierReference: activityId,
            details: {
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
    const bookingId = request.nextUrl.searchParams.get("id") ?? "";

    if (!bookingId) {
      return NextResponse.json(
        { error: "Booking ID is required" },
        { status: 400 }
      );
    }

    const prisma = getPrismaClient();
    const booking = await prisma.booking.findUnique({
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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookingId, status, paymentDetails } = body;

    if (!bookingId || !status) {
      return NextResponse.json(
        { error: "bookingId and status are required" },
        { status: 400 }
      );
    }

    const prisma = getPrismaClient();

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status,
      },
      include: {
        items: true,
        payments: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Booking status updated to ${status}`,
      booking: updatedBooking,
    });
  } catch (error) {
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
