import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { logger } from "@/lib/logger";
import { idParam, moderationBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string; id: string }> };

const patchParams = idParam.extend({ kind: z.enum(["users", "teams"]) });
const deleteParams = idParam.extend({ kind: z.enum(["submissions", "awards"]) });

/**
 * Bannir / masquer un joueur ou une équipe via `manager_api` (rôle manager ou admin). CTFd refuse
 * l'auto-modération et la modération d'un manager/admin par un simple manager, et journalise l'action
 * (logger `pad.audit`) ; le BFF journalise aussi côté front.
 */
export const PATCH = route("manage-moderation", async (req, ctx: Ctx) => {
  const session = await requireApiSession(req, "manager");
  const { kind, id } = patchParams.parse(await ctx.params);
  const patch = moderationBody.parse(await req.json().catch(() => null));
  if (kind === "users") await getCtfd().moderateUser(session.ctfdToken, id, patch);
  else await getCtfd().moderateTeam(session.ctfdToken, id, patch);
  logger.info({ by: session.userId, kind, id, patch }, "modération");
  return NextResponse.json({ ok: true });
});

/** Invalider une soumission (solve annulé) ou un award. */
export const DELETE = route("manage-moderation-invalidate", async (req, ctx: Ctx) => {
  const session = await requireApiSession(req, "manager");
  const { kind, id } = deleteParams.parse(await ctx.params);
  if (kind === "submissions") await getCtfd().invalidateSubmission(session.ctfdToken, id);
  else await getCtfd().invalidateAward(session.ctfdToken, id);
  logger.info({ by: session.userId, kind, id }, "invalidation");
  return NextResponse.json({ ok: true });
});
