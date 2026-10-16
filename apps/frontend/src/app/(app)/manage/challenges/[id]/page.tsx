import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SolvesChart } from "@/components/manage/solves-chart";
import { Badge } from "@/components/ui/form";
import { PageHeader, Panel, Stat } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { CtfdError } from "@/lib/ctfd/http";
import { idParam, statsQuery } from "@/lib/schemas";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Statistiques · Manager" };

export default async function ChallengeStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ bucket?: string }>;
}) {
  const session = await requirePageSession("manager");
  const p = idParam.safeParse(await params);
  if (!p.success) notFound();
  const { bucket } = statsQuery.parse({ bucket: (await searchParams).bucket ?? undefined });
  let stats;
  try {
    stats = await getCtfd().getChallengeStats(session.ctfdToken, p.data.id, bucket);
  } catch (err) {
    if (err instanceof CtfdError && err.status === 404) notFound();
    throw err;
  }
  return (
    <>
      <Link href="/manage/challenges" className="label text-dim no-underline hover:text-amber hover:no-underline">
        ← Challenges
      </Link>
      <PageHeader kicker={stats.category} title={stats.name}>
        <Badge tone={stats.state === "visible" ? "ok" : "amber"}>{stats.state}</Badge>
        <Badge>{stats.type}</Badge>
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Résolutions" value={stats.solves} accent />
        <Stat label="Tentatives" value={stats.attempts} hint={`${stats.incorrectAttempts} incorrecte(s)`} />
        <Stat label="Réussite" value={`${Math.round(stats.successRate * 100)}%`} />
        <Stat label="Valeur" value={stats.value} hint="points" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Résolutions dans le temps"
          aside={
            <span className="flex gap-3">
              <Link href="?bucket=hour" aria-current={bucket === "hour"}>
                heure
              </Link>
              <Link href="?bucket=day" aria-current={bucket === "day"}>
                jour
              </Link>
            </span>
          }
        >
          <SolvesChart data={stats.solvesOverTime} bucket={stats.bucket} />
        </Panel>
        <Panel title="First blood">
          {stats.firstBlood ? (
            <div>
              <p className="font-display text-3xl text-amber">{stats.firstBlood.accountName}</p>
              {stats.firstBlood.userName ? <p className="text-sm text-dim">par {stats.firstBlood.userName}</p> : null}
              <p className="mt-2 text-xs text-muted">{new Date(stats.firstBlood.date).toUTCString()}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Pas encore de first blood.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
