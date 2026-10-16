import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Challenges · Manager" };

export default async function ManageChallengesPage() {
  const session = await requirePageSession("manager");
  const { items } = await getCtfd().listManagedChallenges(session.ctfdToken);
  return (
    <>
      <PageHeader kicker="portail manager" title="Challenges">
        <ButtonLink href="/manage/import">Importer un ZIP</ButtonLink>
      </PageHeader>
      {items.length === 0 ? (
        <EmptyState title="Aucun challenge">Importe un ZIP ou synchronise le dépôt Git.</EmptyState>
      ) : (
        <Panel bodyClassName="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Challenges et statistiques</caption>
            <thead>
              <tr className="label border-b border-line text-left">
                {["Nom", "Catégorie", "Type", "État", "Pts", "Résolu", "Tentatives", "Réussite"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-line/60 last:border-0 hover:bg-panel-hi">
                  <td className="px-3 py-2">
                    <Link href={`/manage/challenges/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-dim">{c.category}</td>
                  <td className="px-3 py-2">{c.instanced ? <Badge tone="info">instance</Badge> : <Badge>{c.type}</Badge>}</td>
                  <td className="px-3 py-2">
                    <Badge tone={c.state === "visible" ? "ok" : "amber"}>{c.state}</Badge>
                  </td>
                  <td className="tabular px-3 py-2">{c.value}</td>
                  <td className="tabular px-3 py-2">{c.solves}</td>
                  <td className="tabular px-3 py-2">{c.attempts}</td>
                  <td className="tabular px-3 py-2">{Math.round(c.successRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
