import type { Metadata } from "next";
import { InstancePanel } from "@/components/challenges/instance-panel";
import { Notice } from "@/components/ui/form";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Test d'instance · Manager" };

export default async function TestInstancePage() {
  const session = await requirePageSession("manager");
  const api = getCtfd();
  const { items } = await api.listManagedChallenges(session.ctfdToken);
  const instanced = items.filter((c) => c.instanced);
  const current = await api.listInstances(session.ctfdToken).catch(() => []);
  const byChallenge = new Map(current.map((i) => [i.challengeId, i]));
  return (
    <>
      <PageHeader kicker="portail manager" title="Test d'instance" />
      <Notice tone="amber" className="mb-6">
        Les managers contournent quotas, délais, renouvellements et visibilité : teste ici un challenge avant de le publier. L&apos;instance est rattachée à
        ton compte (ou à ton équipe si tu en as une) ; pense à l&apos;arrêter ensuite.
      </Notice>
      {instanced.length === 0 ? (
        <EmptyState title="Aucun challenge instancié">Importe un challenge avec un bloc <code>instance</code> pour le tester.</EmptyState>
      ) : (
        <ul className="grid gap-6 md:grid-cols-2">
          {instanced.map((c) => (
            <li key={c.id}>
              <Panel title={c.name} aside={c.state === "visible" ? "visible" : "masqué"}>
                <InstancePanel challengeId={c.id} initial={byChallenge.get(c.id) ?? null} />
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
