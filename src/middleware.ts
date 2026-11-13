import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate: anything outside the public routes needs a session cookie. The real verification
 * (signature, expiry, user still active) happens in requireUser() on every page and action.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/s/") || pathname === "/api/health";
  if (!isPublic && !req.cookies.get("anikey_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
