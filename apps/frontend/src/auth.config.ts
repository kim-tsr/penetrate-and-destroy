import type { NextAuthConfig } from "next-auth";
import { secureCookiesEnabled } from "@/lib/env";

/**
 * Durée de session. Les rôles ne sont plus figés pour cette durée : à chaque réémission du token
 * CTFd (environ 5 min), les groupes sont relus auprès d'Authentik (cf. lib/ctfd-token.ts). La
 * reconnexion SSO reste silencieuse tant que la session Authentik est valide.
 */
export const SESSION_MAX_AGE = 4 * 60 * 60;

/**
 * Configuration Auth.js commune, sans provider ni appel CTFd : utilisable dans `proxy.ts`.
 * Les providers et l'échange `sso/session` vivent dans `auth.ts` (route /api/auth uniquement).
 */
export const baseAuthConfig = {
  providers: [],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  useSecureCookies: secureCookiesEnabled(),
  trustHost: true, // derrière Traefik ; AUTH_URL fixe l'URL canonique
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    session({ session, token }) {
      // Ne recopier QUE des champs non sensibles : ce qui est ici part au navigateur.
      return {
        ...session,
        user: {
          name: token.name ?? "joueur",
          email: token.email ?? null,
          role: token.role ?? "player",
          userId: token.userId ?? 0,
        },
      };
    },
  },
} satisfies NextAuthConfig;
