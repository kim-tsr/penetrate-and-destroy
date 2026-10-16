import type { Metadata } from "next";
import Link from "next/link";
import { InstancePanel } from "@/components/challenges/instance-panel";
import { Notice } from "@/components/ui/form";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { CtfdError } from "@/lib/ctfd/http";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Instances" };

export default async function InstancesPage() {
  const session = await requirePageSession();
  const api = getCtfd();
  const [instances, challenges] = await Promise.all([
    api.listInstances(session.ctfdToken).catch((err) => {
      if (err instanceof CtfdError && err.status === 403) return null; // pas d'équipe
      throw err;
    }),
    api.listChallenges(session.ctfdToken).catch(() => []),
  ]);
  const names = new Map(challenges.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader kicker="chall-manager" title="Instances" />
      <Notice tone="amber" className="mb-6">
        Rappel : active NetBird avant de te connecter à une instance. <Link href="/onboarding">Guide d&apos;installation</Link>.
      </Notice>
      {instances === null ? (
        <EmptyState title="Équipe requise">
          Les instances sont attribuées par équipe. <Link href="/team">Crée ou rejoins une équipe</Link>.
        </EmptyState>
      ) : instances.length === 0 ? (
        <EmptyState title="Aucune instance active">Ouvre un challenge instancié puis lance son instance.</EmptyState>
      ) : (
        <ul className="grid gap-6 md:grid-cols-2">
          {instances.map((i) => (
            <li key={i.challengeId}>
              <Panel
                title={names.get(i.challengeId) ?? `Challenge #${i.challengeId}`}
                aside={<Link href={`/challenges/${i.challengeId}`}>ouvrir</Link>}
              >
                <InstancePanel challengeId={i.challengeId} initial={i} />
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
