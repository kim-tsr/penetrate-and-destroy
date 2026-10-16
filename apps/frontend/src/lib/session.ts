import "server-only";
import { getToken, type JWT } from "next-auth/jwt";
import { headers } from "next/headers";
import { forbidden, redirect, unauthorized } from "next/navigation";
import { resolveCtfdToken } from "./ctfd-token";
import { secureCookiesEnabled } from "./env";
import { hasRole, type Role } from "./roles";

export interface ServerSession {
  name: string;
  email: string | null;
  role: Role;
  userId: number;
  /** Token CTFd de l'utilisateur. Ne JAMAIS le renvoyer au client ni le logguer. */
  ctfdToken: string;
}

/** Lit et déchiffre le JWE de session côté serveur (le token CTFd n'est jamais exposé par `auth()`). */
async function readJwt(hdrs: Headers): Promise<JWT | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const secureCookie = secureCookiesEnabled();
  return getToken({
    req: { headers: hdrs },
    secret,
    secureCookie,
    salt: secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token",
  });
}

export async function getServerSession(hdrs?: Headers): Promise<ServerSession | null> {
  const jwt = await readJwt(hdrs ?? (await headers()));
  if (!jwt?.claims || !jwt.role || !jwt.userId) return null;
  const stored = await resolveCtfdToken({
    sub: jwt.claims.sub,
    claims: jwt.claims,
    token: jwt.ctfdToken,
    exp: jwt.ctfdTokenExp,
    provider: jwt.provider,
    refreshToken: jwt.refreshToken,
  });
  if (!stored) return null;
  return {
    name: jwt.claims.preferred_username || jwt.name || "joueur",
    email: jwt.claims.email || null,
    // Rôle relu à la dernière émission de token (au plus un TTL de token) ; celui du JWE ne sert qu'au début de session.
    role: stored.role ?? jwt.role,
    userId: jwt.userId,
    ctfdToken: stored.token,
  };
}

/** Pour les pages : redirige vers /login, ou 403 si le rôle est insuffisant. */
export async function requirePageSession(minimum: Role = "player"): Promise<ServerSession> {
  const s = await getServerSession();
  if (!s) redirect("/login");
  if (!hasRole(s.role, minimum)) forbidden();
  return s;
}

/** Pour les server actions : lève 401/403 au lieu de rediriger. */
export async function requireActionSession(minimum: Role = "player"): Promise<ServerSession> {
  const s = await getServerSession();
  if (!s) unauthorized();
  if (!hasRole(s.role, minimum)) forbidden();
  return s;
}
