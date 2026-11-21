import { NextResponse } from "next/server";
import { guardRoute } from "@/server/tenant-context";
import { supplierStatus } from "@/server/suppliers/registry";

/** Which suppliers are connected. Names and booleans only; never credentials. */
export async function GET() {
  const denied = await guardRoute("chat:use");
  if (denied) return denied;
  return NextResponse.json({ success: true, suppliers: supplierStatus() });
}
