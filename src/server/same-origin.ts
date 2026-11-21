import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF defence for state-changing routes, on top of SameSite cookies: if the browser sent an Origin
 * header it must match this site. Requests without Origin (curl, server-to-server) are not browsers
 * and are allowed; they still need a valid session cookie.
 */
export function crossOriginResponse(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host === request.nextUrl.host) return null;
  } catch {
    // fall through
  }
  return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
}
