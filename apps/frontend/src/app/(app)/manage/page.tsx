import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/form";
import { PageHeader, Panel, Stat } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { EVENT_STATE_LABEL, getEventView } from "@/lib/event";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Manager" };

export default async function ManageHomePage() {
  const session = await requirePageSession("manager");
  const [{ items, summary }, event] = await Promise.all([getCtfd().listManagedChallenges(session.ctfdToken), getEventView(session)]);
  const hidden = items.filter((c) => c.state !== "visible").length;
  const top = [...items].sort((a, b) => b.solves - a.solves).slice(0, 5);
  return (
    <>
      <PageHeader kicker="portail manager" title="Vue d'ensemble" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Challenges" value={summary.count} hint={`${hidden} masqué${hidden > 1 ? "s" : ""}`} accent />
        <Stat label="Résolutions" value={summary.solves} />
        <Stat label="Tentatives" value={summary.attempts} />
        <Stat label="Taux de réussite" value={`${Math.round(summary.successRate * 100)}%`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Événement" aside={<Link href="/manage/event">modifier</Link>}>
          <Badge tone={event.state === "running" ? "ok" : "amber"}>{EVENT_STATE_LABEL[event.state]}</Badge>
          <dl className="mt-3 space-y-1 text-sm text-dim">
            <div>Début : {event.start ? new Date(event.start).toUTCString() : "non défini"}</div>
            <div>Fin : {event.end ? new Date(event.end).toUTCString() : "non définie"}</div>
          </dl>
        </Panel>
        <Panel title="Challenges les plus résolus" aside={<Link href="/manage/challenges">tous</Link>}>
          <ol className="divide-y divide-line">
            {top.map((c) => (
              <li key={c.id} className="flex items-baseline gap-3 py-2 text-sm">
                <Link href={`/manage/challenges/${c.id}`} className="flex-1 truncate">
                  {c.name}
                </Link>
                <span className="tabular font-display text-xl">{c.solves}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}
