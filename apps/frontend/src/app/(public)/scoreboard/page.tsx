import { connection } from "next/server";
import type { Metadata } from "next";
import { LiveScoreboard } from "@/components/scoreboard/live-scoreboard";
import { PageHeader } from "@/components/ui/panel";
import { getScoreboardSnapshot } from "@/lib/scoreboard-feed";
import { getServerSession } from "@/lib/session";

export const metadata: Metadata = { title: "Scoreboard" };

export default async function PublicScoreboardPage() {
  await connection();
  const session = await getServerSession().catch(() => null);
  const snap = await getScoreboardSnapshot(session?.ctfdToken ?? null).catch(() => null);
  return (
    <>
      <PageHeader kicker="en direct" title="Scoreboard" />
      <LiveScoreboard
        initial={snap ? { entries: snap.entries, series: snap.series, at: snap.at } : null}
        highlight={null}
      />
    </>
  );
}
