import { type NextRequest, NextResponse } from "next/server";
import { gateFrom, SESSION_COOKIE, verifySession } from "./server/session.ts";

/**
 * The first, optimistic check: no valid session, no page. Pages and server actions
 * check again (server/auth.ts), because a proxy is not the only way in.
 */
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySession(gateFrom(process.env), token, Math.floor(Date.now() / 1000))) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
