import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTravelDeskClient, TravelDeskError } from "@/integrations/traveldesk/client";
import { checkTravelDeskAvailability } from "@/server/suppliers/traveldesk-availability";
import { guardRoute } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  tourId: z.coerce.number().int().positive(),
  offerId: z.coerce.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.coerce.number().int().min(1).max(15),
  children: z.coerce.number().int().min(0).max(14).default(0),
});

/** Live Traveldesk availability for one tour on one date. Reads only; nothing is reserved. */
export async function GET(request: NextRequest) {
  const denied = await guardRoute("chat:use");
  if (denied) return denied;

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

  let client;
  try {
    client = getTravelDeskClient();
  } catch {
    return NextResponse.json({ error: "SUPPLIER_NOT_CONFIGURED" }, { status: 503 });
  }
  try {
    const availability = await checkTravelDeskAvailability(client, parsed.data);
    return NextResponse.json({ success: true, liveInventory: availability.environment === "production", ...availability });
  } catch (error) {
    const message = error instanceof TravelDeskError ? error.message : "Traveldesk request failed";
    return NextResponse.json({ error: "SUPPLIER_ERROR", message }, { status: 502 });
  }
}
