import { NextResponse } from "next/server";
import { route } from "@/lib/bff";
import { CtfdError } from "@/lib/ctfd/http";
import { getScoreboardSnapshot } from "@/lib/scoreboard-feed";
import { topQuery } from "@/lib/schemas";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Scoreboard (public si CTFd l'autorise ; le jeton du joueur connecté est utilisé sinon). */
export const GET = route("scoreboard", async (req) => {
  const { top } = topQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const session = await getServerSession(req.headers);
  try {
    const snap = await getScoreboardSnapshot(session?.ctfdToken ?? null, top);
    return NextResponse.json({ entries: snap.entries, series: snap.series });
  } catch (err) {
    if (err instanceof CtfdError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json({ error: "Le scoreboard n'est pas public" }, { status: 403 });
    }
    throw err;
  }
});
