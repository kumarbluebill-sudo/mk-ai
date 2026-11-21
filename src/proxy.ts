import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

// Optimistic gate only. Every API handler still enforces auth itself via requireTenantContext().
export const proxy = auth((req) => {
  if (!req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/chat/:path*", "/settings/:path*", "/designer/:path*", "/bookings/:path*", "/dashboard/:path*", "/team/:path*", "/admin/:path*"],
};
