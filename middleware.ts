import { NextResponse, type NextRequest } from "next/server";
import { rolesForPath, verifySessionToken, SESSION_COOKIE, homeForRole } from "@/lib/auth/core";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const roles = rolesForPath(pathname);
  if (!roles) return NextResponse.next();

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = new URL("/staff/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (!roles.includes(session.role)) {
    // Signed in, but this portal is not their job — send them to their own home.
    const url = new URL(homeForRole(session.role), request.url);
    url.searchParams.set("denied", "1");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/counter/:path*", "/kitchen/:path*", "/delivery/:path*"],
};
