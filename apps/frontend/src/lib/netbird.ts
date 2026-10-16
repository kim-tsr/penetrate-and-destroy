import "server-only";
import { z } from "zod";
import { isMockMode } from "./env";
import { logger } from "./logger";

/**
 * État NetBird d'un joueur, via l'API de management (lecture seule, jeton `NETBIRD_API_TOKEN`
 * jamais transmis au navigateur).
 *  - connected  : au moins un pair du joueur est connecté ;
 *  - registered : le joueur a un compte NetBird mais aucun pair connecté ;
 *  - absent     : aucun compte NetBird pour cet e-mail ;
 *  - unknown    : API non configurée ou injoignable (l'UI se contente alors du guide d'installation).
 */
export type NetbirdState = "connected" | "registered" | "absent" | "unknown";

const users = z.array(z.looseObject({ id: z.string(), email: z.string().nullish() }));
const peers = z.array(z.looseObject({ user_id: z.string().nullish(), connected: z.boolean().default(false) }));

export async function netbirdState(email: string | null, fetchImpl: typeof fetch = fetch): Promise<NetbirdState> {
  if (isMockMode()) return "absent";
  const base = process.env.NETBIRD_API_URL;
  const token = process.env.NETBIRD_API_TOKEN;
  if (!base || !token || !email) return "unknown";
  const call = async (path: string) => {
    const res = await fetchImpl(`${base.replace(/\/+$/, "")}${path}`, {
      headers: { Authorization: `Token ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`NetBird ${path} : HTTP ${res.status}`);
    return res.json();
  };
  try {
    const all = users.parse(await call("/users"));
    const user = all.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) return "absent";
    const mine = peers.parse(await call("/peers")).filter((p) => p.user_id === user.id);
    return mine.some((p) => p.connected) ? "connected" : "registered";
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "API NetBird indisponible");
    return "unknown";
  }
}
