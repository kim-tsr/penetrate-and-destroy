import { NextResponse } from "next/server";
import { enforceRateLimit, requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { hintParams } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Déverrouille un indice (le coût est débité par CTFd) et renvoie son contenu. */
export const POST = route("hint-unlock", async (req, ctx: { params: Promise<{ id: string; hintId: string }> }) => {
  const session = await requireApiSession(req);
  const { hintId } = hintParams.parse(await ctx.params);
  await enforceRateLimit(`hint:${session.userId}`, 30, 60);
  const hint = await getCtfd().unlockHint(session.ctfdToken, hintId);
  return NextResponse.json(hint);
});
