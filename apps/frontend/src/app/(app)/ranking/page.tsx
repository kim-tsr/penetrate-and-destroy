import type { Metadata } from "next";
import { LiveScoreboard } from "@/components/scoreboard/live-scoreboard";
import { PageHeader } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { getScoreboardSnapshot } from "@/lib/scoreboard-feed";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Classement" };

export default async function RankingPage() {
  const session = await requirePageSession();
  const [snap, me, team] = await Promise.all([
    getScoreboardSnapshot(session.ctfdToken).catch(() => null),
    getCtfd().getMe(session.ctfdToken),
    getCtfd().getMyTeam(session.ctfdToken).catch(() => null),
  ]);
  return (
    <>
      <PageHeader kicker="en direct" title="Classement" />
      <LiveScoreboard
        initial={snap ? { entries: snap.entries, series: snap.series, at: snap.at } : null}
        highlight={team?.name ?? me.name}
      />
    </>
  );
}
