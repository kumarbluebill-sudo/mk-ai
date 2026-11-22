import { NextRequest, NextResponse } from "next/server";
import { bookingErrorResponse } from "@/server/booking/http";
import { getAgencyVoucher, getVoucher } from "@/server/booking/traveldesk-booking";
import { requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext("booking:read");
    const { id } = await params;
    // ?type=agency renders our own voucher from the stored booking; the default is the supplier's voucher.
    const agency = request.nextUrl.searchParams.get("type") === "agency";
    const { reference, bytes } = agency ? await getAgencyVoucher(ctx, id) : await getVoucher(ctx, id);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${agency ? "agency-voucher" : "voucher"}-${reference}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return bookingErrorResponse(error, "Failed to fetch voucher");
  }
}
