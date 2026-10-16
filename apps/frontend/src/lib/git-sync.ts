import "server-only";
import { z } from "zod";
import { logger } from "./logger";

/**
 * Statut de la synchronisation Git -> CTFd, publié par la CI (job `ctfcli`/`challenges/sync.sh`) sous
 * forme d'un JSON accessible à `PAD_GIT_SYNC_STATUS_URL` (ex. artefact ou objet Garage en lecture).
 */
export const gitSyncSchema = z.object({
  commit: z.string().max(64),
  branch: z.string().max(100).default("main"),
  syncedAt: z.iso.datetime({ offset: true }),
  results: z
    .array(
      z.object({
        name: z.string().max(200),
        status: z.enum(["created", "updated", "unchanged", "failed"]),
        message: z.string().max(500).optional(),
      }),
    )
    .max(500)
    .default([]),
});
export type GitSyncStatus = z.infer<typeof gitSyncSchema>;

export type GitSyncResult =
  | { state: "unconfigured" }
  | { state: "unavailable"; reason: string }
  | { state: "ok"; status: GitSyncStatus };

export async function getGitSyncStatus(fetchImpl: typeof fetch = fetch): Promise<GitSyncResult> {
  const url = process.env.PAD_GIT_SYNC_STATUS_URL;
  if (!url) return { state: "unconfigured" };
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000), cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return { state: "unavailable", reason: `HTTP ${res.status}` };
    return { state: "ok", status: gitSyncSchema.parse(await res.json()) };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "statut de synchro Git indisponible");
    return { state: "unavailable", reason: "statut illisible ou injoignable" };
  }
}
