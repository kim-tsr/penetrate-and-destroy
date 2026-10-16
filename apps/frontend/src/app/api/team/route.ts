import { NextResponse } from "next/server";
import { enforceRateLimit, requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { teamCredentials } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Crée une équipe (le joueur en devient capitaine). */
export const POST = route("team-create", async (req) => {
  const session = await requireApiSession(req);
  const input = teamCredentials.parse(await req.json().catch(() => null));
  await enforceRateLimit(`team:${session.userId}`, 10, 60);
  await getCtfd().createTeam(session.ctfdToken, input);
  return NextResponse.json({ ok: true }, { status: 201 });
});

/** Quitte l'équipe courante. */
export const DELETE = route("team-leave", async (req) => {
  const session = await requireApiSession(req);
  await enforceRateLimit(`team:${session.userId}`, 10, 60);
  await getCtfd().leaveTeam(session.ctfdToken);
  return NextResponse.json({ ok: true });
});
