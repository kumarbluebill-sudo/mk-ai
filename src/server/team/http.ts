import { NextResponse } from "next/server";
import { authErrorResponse } from "@/server/tenant-context";
import { TeamError } from "./members";

const STATUS: Record<TeamError["code"], number> = {
  FORBIDDEN_ROLE: 403,
  NOT_FOUND: 404,
  EMAIL_IN_USE: 409,
  SELF: 400,
  INVALID: 400,
};

export function teamErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof TeamError) return NextResponse.json({ error: error.code, message: error.message }, { status: STATUS[error.code] });
  const auth = authErrorResponse(error);
  if (auth) return auth;
  console.error(`[team] ${fallback}:`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
