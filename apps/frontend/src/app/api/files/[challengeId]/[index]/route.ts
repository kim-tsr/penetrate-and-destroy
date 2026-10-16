import { enforceRateLimit, jsonError, requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { fileParams } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/**
 * Télécharge un fichier de challenge. Le token de fichier CTFd reste côté serveur : le navigateur
 * ne connaît que `/api/files/<challenge>/<index>`. La réponse est toujours forcée en pièce jointe
 * (jamais rendue dans l'origine du front, même si le fichier est du HTML).
 */
export const GET = route("files", async (req, ctx: { params: Promise<{ challengeId: string; index: string }> }) => {
  const session = await requireApiSession(req);
  const { challengeId, index } = fileParams.parse(await ctx.params);
  await enforceRateLimit(`file:${session.userId}`, 60, 60);
  const upstream = await getCtfd().fetchChallengeFile(session.ctfdToken, challengeId, index);
  if (!upstream || upstream.status === 404) return jsonError(404, "Fichier introuvable");
  if (!upstream.ok || !upstream.body) return jsonError(upstream.status === 403 ? 403 : 502, "Fichier indisponible");
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": upstream.headers.get("content-disposition")?.replace(/^inline/i, "attachment") ?? "attachment",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new Response(upstream.body, { headers });
});
