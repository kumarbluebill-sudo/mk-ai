import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { buildCsp, newNonce } from "./server/csp";

const { auth } = NextAuth(authConfig);

/** Pages that need a signed-in user. Optimistic gate only: every API handler still enforces auth itself. */
const PROTECTED = ["/chat", "/settings", "/designer", "/bookings", "/dashboard", "/team", "/admin"];
const isProtected = (path: string) => path === "/" || PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

export const proxy = auth((req) => {
  // A fresh nonce per request. The policy goes on the request too, because that is where Next.js finds the nonce.
  const csp = buildCsp(newNonce(), process.env.NODE_ENV !== "production");

  if (isProtected(req.nextUrl.pathname) && !req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("next", req.nextUrl.pathname);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  const headers = new Headers(req.headers);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
});

export const config = {
  // Every page. API routes, build output, icons, the service worker and the manifest do not render HTML.
  matcher: ["/((?!api|_next/static|_next/image|icons|sw\.js|manifest\.webmanifest|favicon\.ico).*)"],
};
