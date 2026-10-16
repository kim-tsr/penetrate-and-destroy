import { NextResponse } from "next/server";
import { enforceRateLimit, requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { teamCredentials } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Rejoint une équipe par nom + mot de passe (limite stricte : le mot de passe d'équipe est devinable). */
export const POST = route("team-join", async (req) => {
  const session = await requireApiSession(req);
  const input = teamCredentials.parse(await req.json().catch(() => null));
  // Fail-closed : sans compteur fiable, pas d'essai de mot de passe (CTFd applique en plus sa propre limite).
  await enforceRateLimit(`team-join:${session.userId}`, 5, 60, { failClosed: true });
  await getCtfd().joinTeam(session.ctfdToken, input);
  return NextResponse.json({ ok: true });
});
