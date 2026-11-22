import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardRoute } from "@/server/tenant-context";
import { searchInventory } from "@/server/suppliers/search";
import { supplierRuntime } from "@/server/suppliers/settings";

const querySchema = z.object({
  category: z.enum(["activity", "hotel", "flight", "transfer", "package"]).default("activity"),
  keyword: z.string().trim().min(2).max(200),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.enum(["USD", "EUR", "GBP", "AUD", "CAD"]).default("USD"),
  sort: z.enum(["relevance", "price", "rating"]).default("relevance"),
  maxPrice: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  fresh: z.enum(["true", "false"]).default("false"),
});

/** Unified, parallel supplier search. Thin handler: all logic lives in src/server/suppliers. */
export async function GET(request: NextRequest) {
  const denied = await guardRoute("chat:use");
  if (denied) return denied;

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid search parameters" }, { status: 400 });
  }
  const q = parsed.data;

  const result = await searchInventory(
    { category: q.category, keyword: q.keyword, startDate: q.startDate, currency: q.currency, limit: q.limit },
    {
      sort: q.sort,
      maxPriceMinor: q.maxPrice ? Math.round(q.maxPrice * 100) : undefined,
      useCache: q.fresh !== "true",
      ...(await supplierRuntime()),
    }
  );
  return NextResponse.json({ success: true, ...result });
}
