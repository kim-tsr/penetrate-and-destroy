import "server-only";
import { createHash } from "node:crypto";
import { getCtfd } from "./ctfd/client";
import type { ScoreSeries, ScoreboardEntry } from "./ctfd/types";

export interface ScoreboardSnapshot {
  entries: ScoreboardEntry[];
  series: ScoreSeries[];
  /** Empreinte du contenu : le flux SSE n'émet que si elle change. */
  hash: string;
  at: number;
}

const TTL_MS = 3_000;
const g = globalThis as unknown as {
  __padScoreboard?: Map<string, { snap: ScoreboardSnapshot; promise?: Promise<ScoreboardSnapshot> }>;
};

/**
 * Instantané du scoreboard, mis en cache 3 s par processus : N clients SSE ne produisent qu'un
 * appel amont toutes les 3 s. Les entrées « public » et « authentifié » sont séparées car CTFd peut
 * réserver le scoreboard aux comptes connectés.
 */
export async function getScoreboardSnapshot(token: string | null, top = 10): Promise<ScoreboardSnapshot> {
  const cache = (g.__padScoreboard ??= new Map());
  const key = `${token ? "auth" : "public"}:${top}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.snap.at < TTL_MS) return hit.snap;
  if (hit?.promise) return hit.promise;

  const promise = (async () => {
    const api = getCtfd();
    const [entries, series] = await Promise.all([api.getScoreboard(token), api.getTopSeries(token, top).catch(() => [])]);
    const hash = createHash("sha1").update(JSON.stringify([entries, series.map((s) => [s.accountId, s.points.length])])).digest("hex");
    const snap: ScoreboardSnapshot = { entries, series, hash, at: Date.now() };
    cache.set(key, { snap });
    return snap;
  })();
  cache.set(key, { snap: hit?.snap ?? { entries: [], series: [], hash: "", at: 0 }, promise });
  try {
    return await promise;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}
