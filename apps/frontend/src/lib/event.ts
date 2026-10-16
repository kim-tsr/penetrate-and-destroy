import "server-only";
import { eventStateFromDates } from "./ctfd/adapter";
import { getCtfd } from "./ctfd/client";
import type { EventConfig, EventState } from "./ctfd/types";
import { getKv } from "./kv";
import { hasRole, type Role } from "./roles";

/**
 * Phase de l'événement visible par tous les joueurs.
 *
 * Source de vérité : CTFd. Un joueur authentifié lit `GET /api/v1/pad/event` (plugin `pad_public`),
 * un manager `GET /api/v1/manager/event` (identique). Deux replis, du plus frais au plus ancien :
 * - `cache` : dernière valeur lue en direct, conservée dans Valkey. Elle sert aux pages publiques
 *   (accueil, sans session donc sans token CTFd) et à une indisponibilité passagère de CTFd ;
 * - `env` : `PAD_EVENT_START` / `PAD_EVENT_END` quand rien n'a encore été lu.
 */
export interface EventView {
  name: string;
  start: string | null;
  end: string | null;
  freeze: string | null;
  paused: boolean;
  state: EventState;
  source: "ctfd" | "cache" | "env";
}

const CACHE_KEY = "event:cfg";
const CACHE_TTL_S = 24 * 3600;

type Cached = Pick<EventConfig, "start" | "end" | "freeze" | "paused">;

export async function cacheEvent(cfg: EventConfig): Promise<void> {
  const value: Cached = { start: cfg.start, end: cfg.end, freeze: cfg.freeze, paused: cfg.paused };
  try {
    await getKv().set(CACHE_KEY, JSON.stringify(value), CACHE_TTL_S);
  } catch {
    // non bloquant
  }
}

async function readCache(): Promise<Cached | null> {
  try {
    const raw = await getKv().get(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

export function eventName(): string {
  return process.env.PAD_EVENT_NAME || "PenetrateAndDestroy";
}

export async function getEventView(session?: { role: Role; ctfdToken: string }): Promise<EventView> {
  const name = eventName();
  if (session) {
    try {
      const api = getCtfd();
      const live = hasRole(session.role, "manager") ? await api.getEvent(session.ctfdToken) : await api.getPublicEvent(session.ctfdToken);
      await cacheEvent(live);
      return { name, ...live, source: "ctfd" };
    } catch {
      // CTFd indisponible ou plugin absent : repli sur la dernière valeur connue
    }
  }
  const cached = await readCache();
  if (cached) return { name, ...cached, state: eventStateFromDates(cached), source: "cache" };
  const fromEnv: Cached = {
    start: process.env.PAD_EVENT_START || null,
    end: process.env.PAD_EVENT_END || null,
    freeze: null,
    paused: false,
  };
  return { name, ...fromEnv, state: eventStateFromDates(fromEnv), source: "env" };
}

export { EVENT_STATE_LABEL } from "./event-labels";
