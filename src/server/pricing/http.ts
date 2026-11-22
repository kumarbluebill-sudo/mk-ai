import { NextResponse } from "next/server";
import { authErrorResponse } from "@/server/tenant-context";
import { PricingRuleError } from "./service";

/** Maps pricing errors to HTTP answers (kept out of the route files, which may only export HTTP methods). */
export function ruleErrorResponse(error: unknown, fallback: string) {
  if (error instanceof PricingRuleError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
  return authErrorResponse(error) ?? NextResponse.json({ error: fallback }, { status: 500 });
}
