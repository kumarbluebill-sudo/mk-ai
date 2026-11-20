import { NextRequest, NextResponse } from "next/server";
import { searchDestinations } from "@/lib/destinations";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({
    source: "DEMO DATA",
    liveInventory: false,
    results: searchDestinations(query),
  });
}
