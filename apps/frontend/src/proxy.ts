import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { baseAuthConfig } from "./auth.config";
import { buildCsp, generateNonce } from "./lib/csp";
import { getMetrics, markActive } from "./lib/metrics";
import { canManage, type Role } from "./lib/roles";

const { auth } = NextAuth(baseAuthConfig);

/** Pages et API accessibles sans session. */
const PUBLIC_PAGES = new Set(["/", "/login", "/rules", "/scoreboard", "/forbidden"]);
// /api/scoreboard : scoreboard public (CTFd décide s'il l'autorise aux anonymes) ; /api/metrics se protège par jeton.
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/health", "/api/metrics", "/api/scoreboard"];

function issuerOrigin(): string[] {
  try {
    return process.env.AUTH_AUTHENTIK_ISSUER ? [new URL(process.env.AUTH_AUTHENTIK_ISSUER).origin] : [];
  } catch {
    return [];
  }
}

/**
 * Première ligne de défense (redirections, rôle /manage, CSP). Chaque page, route handler et
 * server action revérifie la session et le rôle : le proxy n'est jamais la seule barrière.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const user = req.auth?.user as { role?: Role; userId?: number } | undefined;
  const role = user?.role;

  const isPublic = isApi ? PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) : PUBLIC_PAGES.has(pathname);
  const isManage = pathname === "/manage" || pathname.startsWith("/manage/") || pathname.startsWith("/api/manage/");

  if (!isApi) getMetrics().httpRequests.inc({ kind: "page", route: "page", method: req.method, status: "proxy" });
  if (user?.userId) void markActive(user.userId);

  if (!isPublic && !user) {
    if (isApi) return NextResponse.json({ error: "Session expirée, reconnecte-toi" }, { status: 401 });
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  if (isManage && !canManage(role)) {
    if (isApi) return NextResponse.json({ error: "Accès réservé aux managers" }, { status: 403 });
    return NextResponse.rewrite(new URL("/forbidden", req.nextUrl), { status: 403 });
  }
  if (pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  if (isApi) return NextResponse.next();

  const nonce = generateNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === "development", formActions: issuerOrigin() });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
});

export const config = {
  matcher: [
    {
      // Sondes et métriques ne passent pas par Auth.js (pas de cookie CSRF, pas de session).
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|api/health|api/metrics).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
