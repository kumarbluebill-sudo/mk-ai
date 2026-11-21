import { NextRequest, NextResponse } from "next/server";
import { bookingErrorResponse } from "@/server/booking/http";
import { getVoucher } from "@/server/booking/traveldesk-booking";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext("booking:read");
    const { id } = await params;
    const { reference, bytes } = await getVoucher(ctx, id);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="voucher-${reference}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return bookingErrorResponse(error, "Failed to fetch voucher");
  }
}
