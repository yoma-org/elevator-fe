import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "yecl-admin-session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // Check for session cookie
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Validate token is not expired (decode JWT payload without verification)
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) throw new Error();
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      // Token expired — clear cookie and redirect to login
      const res = NextResponse.redirect(new URL("/login", request.url));
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
  } catch {
    // Invalid token — redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Allow known admin sub-routes
  const allowedPaths = ["/admin"];
  if (allowedPaths.includes(pathname)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/admin", request.url));
}

export const config = {
  matcher: ["/admin/:path*", "/admin"],
};
