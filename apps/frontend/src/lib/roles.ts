/** Rôles applicatifs. Les groupes viennent d'Authentik (contracts: identity.groups). */
export const ROLES = ["player", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const GROUP_TO_ROLE: Record<string, Role> = {
  "ctf-players": "player",
  "ctf-managers": "manager",
  "ctf-admins": "admin",
};

const RANK: Record<Role, number> = { player: 0, manager: 1, admin: 2 };

/** Rôle le plus élevé déduit des groupes OIDC, ou `null` si aucun groupe CTF. */
export function roleFromGroups(groups: readonly string[] | undefined | null): Role | null {
  let best: Role | null = null;
  for (const g of groups ?? []) {
    const r = GROUP_TO_ROLE[g];
    if (r && (best === null || RANK[r] > RANK[best])) best = r;
  }
  return best;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function hasRole(role: Role | null | undefined, minimum: Role): boolean {
  return role != null && RANK[role] >= RANK[minimum];
}

export function canManage(role: Role | null | undefined): boolean {
  return hasRole(role, "manager");
}
