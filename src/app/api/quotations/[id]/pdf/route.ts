import { NextRequest, NextResponse } from "next/server";
import { getQuotationPdf, QuotationError } from "@/server/quotation/service";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantContext("quotation:read");
    const { id } = await params;
    const { reference, bytes } = await getQuotationPdf(ctx, id);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${reference}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof QuotationError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 409 });
    }
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
