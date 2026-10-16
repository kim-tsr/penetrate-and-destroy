import type { SsoClaims } from "@/lib/ctfd/types";
import type { Role } from "@/lib/roles";

declare module "next-auth" {
  /** Session exposée au client : AUCUN token CTFd ici. */
  interface Session {
    user: {
      name: string;
      email: string | null;
      role: Role;
      userId: number;
    };
  }
}

declare module "@auth/core/jwt" {
  /** Contenu du JWE (cookie chiffré) : lisible uniquement côté serveur. */
  interface JWT {
    role?: Role;
    userId?: number;
    ctfdToken?: string;
    /** Échéance du token CTFd (ms epoch). */
    ctfdTokenExp?: number;
    /** Claims OIDC conservés pour réémettre un token CTFd après expiration. */
    claims?: SsoClaims;
    /** Fournisseur de connexion ("mock" hors production). */
    provider?: string;
    /** Refresh token OIDC (scope offline_access) : sert à relire les groupes à chaque réémission. */
    refreshToken?: string;
  }
}
