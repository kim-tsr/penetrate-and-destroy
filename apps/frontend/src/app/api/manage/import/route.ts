import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, requireApiSession, route } from "@/lib/bff";
import { inspectChallengeZip } from "@/lib/challenge-yml/parse-zip";
import { getCtfd } from "@/lib/ctfd/client";
import { logger } from "@/lib/logger";
import { zipUpload } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 330;

/**
 * Import d'un ZIP `challenge.yml` (ctfcli étendu). Le ZIP est re-validé ici (taille, extension,
 * schéma zod, fichiers présents) avant d'être transmis à `manager_api`, qui valide de nouveau avec
 * le schéma JSON de référence, téléverse les fichiers sur Garage et enregistre le scénario dans chall-manager.
 */
export const POST = route("manage-import", async (req) => {
  const session = await requireApiSession(req, "manager");
  await enforceRateLimit(`import:${session.userId}`, 10, 60);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "Champ « file » (ZIP) manquant");
  const meta = zipUpload.safeParse({ name: file.name, size: file.size });
  if (!meta.success) return jsonError(400, meta.error.issues[0]?.message ?? "Archive invalide");

  const preview = await inspectChallengeZip(await file.arrayBuffer());
  if (!preview.ok || !preview.challenge) {
    return jsonError(422, "challenge.yml invalide", { details: preview.issues.map((i) => `${i.path} : ${i.message}`) });
  }
  const result = await getCtfd().importChallenge(session.ctfdToken, file, file.name);
  logger.info({ userId: session.userId, challenge: result.name, action: result.action }, "challenge importé");
  return NextResponse.json({ result, warnings: [] }, { status: result.action === "created" ? 201 : 200 });
});
