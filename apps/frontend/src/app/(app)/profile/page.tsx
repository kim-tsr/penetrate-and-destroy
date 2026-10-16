import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/form";
import { EmptyState, PageHeader, Panel, Stat } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { requirePageSession } from "@/lib/session";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const session = await requirePageSession();
  const api = getCtfd();
  const me = await api.getMe(session.ctfdToken);
  const solves = await api.getRecentSolves(session.ctfdToken, me.teamId).catch(() => []);
  return (
    <>
      <PageHeader kicker="identité" title={me.name}>
        <Badge tone={session.role === "player" ? "neutral" : "amber"}>{session.role}</Badge>
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Score" value={me.score} accent />
        <Stat label="Rang" value={me.place ? `#${me.place}` : "—"} />
        <Stat label="Résolutions" value={solves.length} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Compte">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="label">Pseudo</dt>
              <dd>{me.name}</dd>
            </div>
            <div>
              <dt className="label">E-mail</dt>
              <dd>{me.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="label">Rôle</dt>
              <dd>{session.role}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">
            Identité et groupes gérés par Authentik : pour les modifier, passe par les organisateurs.
          </p>
        </Panel>
        <Panel title="Historique des résolutions" bodyClassName="p-0">
          {solves.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Aucune résolution">
                <Link href="/challenges">Va chercher ton premier flag.</Link>
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {solves.map((s) => (
                <li key={`${s.challengeId}-${s.date}`} className="flex items-baseline gap-3 px-4 py-2 text-sm">
                  <Link href={`/challenges/${s.challengeId}`} className="flex-1 truncate">
                    {s.challengeName}
                  </Link>
                  <span className="text-xs text-muted">{s.userName}</span>
                  <span className="tabular font-display text-xl text-amber">+{s.value}</span>
                  <span className="hidden w-28 text-right text-xs text-muted sm:block">{formatRelative(s.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
