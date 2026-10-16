import NextAuth, { type NextAuthConfig } from "next-auth";
import Authentik from "next-auth/providers/authentik";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { baseAuthConfig } from "./auth.config";
import { getCtfd } from "@/lib/ctfd/client";
import type { SsoClaims } from "@/lib/ctfd/types";
import { isMockMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { storeRefreshToken } from "@/lib/oidc-revalidate";
import { roleFromGroups, type Role } from "@/lib/roles";

const mockInput = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[\w.-]+$/),
  role: z.enum(["player", "manager", "admin"]).default("player"),
});

const MOCK_GROUPS: Record<Role, string[]> = {
  player: ["ctf-players"],
  manager: ["ctf-players", "ctf-managers"],
  admin: ["ctf-players", "ctf-admins"],
};

type MockUser = { id: string; name: string; email: string; groups: string[] };

function providers(): NextAuthConfig["providers"] {
  const list: NextAuthConfig["providers"] = [];
  if (process.env.AUTH_AUTHENTIK_ISSUER) {
    list.push(
      Authentik({
        clientId: process.env.AUTH_AUTHENTIK_ID ?? "pad-frontend", // contracts: identity.oidc_clients.frontend
        clientSecret: process.env.AUTH_AUTHENTIK_SECRET,
        issuer: process.env.AUTH_AUTHENTIK_ISSUER,
        authorization: { params: { scope: "openid email profile groups offline_access" } },
        checks: ["pkce", "state", "nonce"],
      }),
    );
  }
  // Connexion simulée : uniquement PAD_MOCK=1 hors production (démarrage refusé sinon, cf. instrumentation.ts).
  if (isMockMode()) {
    list.push(
      Credentials({
        id: "mock",
        name: "Connexion simulée",
        credentials: { username: { label: "Pseudo" }, role: { label: "Rôle" } },
        authorize(raw) {
          const parsed = mockInput.safeParse(raw);
          if (!parsed.success) return null;
          const { username, role } = parsed.data;
          const user: MockUser = {
            id: `mock-${username}`,
            name: username,
            email: `${username}@mock.pad.example`,
            groups: MOCK_GROUPS[role],
          };
          return user;
        },
      }),
    );
  }
  return list;
}

function groupsOf(account: { provider?: string } | null | undefined, user: unknown, profile: unknown): string[] {
  const src = account?.provider === "mock" ? (user as { groups?: unknown }) : (profile as { groups?: unknown } | undefined);
  const g = src?.groups;
  return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : [];
}

export const authConfig = {
  ...baseAuthConfig,
  providers: providers(),
  callbacks: {
    ...baseAuthConfig.callbacks,
    async signIn({ profile, user, account }) {
      // Seuls les membres d'un groupe CTF peuvent se connecter.
      return roleFromGroups(groupsOf(account, user, profile)) !== null;
    },
    async jwt({ token, account, profile, user }) {
      if (!account) return token; // requêtes suivantes : JWE inchangé
      const isMock = account.provider === "mock";
      const p = (profile ?? {}) as { sub?: string; email?: string; preferred_username?: string; name?: string };
      const claims: SsoClaims = {
        sub: String((isMock ? user.id : p.sub) ?? token.sub ?? ""),
        email: String((isMock ? user.email : p.email) ?? ""),
        preferred_username: String((isMock ? user.name : (p.preferred_username ?? p.name)) ?? ""),
        groups: groupsOf(account, user, profile),
      };
      const session = await getCtfd().createSession(claims);
      logger.info({ userId: session.userId, role: session.role }, "session CTFd ouverte");
      token.claims = claims;
      token.provider = account.provider;
      // Refresh token OIDC : relecture des groupes à chaque réémission du token CTFd.
      token.refreshToken = isMock ? undefined : (account.refresh_token ?? undefined);
      if (token.refreshToken) await storeRefreshToken(claims.sub, token.refreshToken);
      token.ctfdToken = session.token;
      token.ctfdTokenExp = session.expiresAt;
      token.userId = session.userId;
      // CTFd fait autorité sur le rôle (resynchronisé depuis les groupes à chaque émission de token).
      token.role = session.role;
      token.name = session.name;
      return token;
    },
  },
  logger: {
    error: (error) => logger.error({ err: error.message, type: error.name }, "auth.js"),
    warn: (code) => logger.warn({ code }, "auth.js"),
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
