import type { Metadata } from "next";
import Link from "next/link";
import { Countdown } from "@/components/clock";
import { Badge } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, Stat } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { netbirdState, type NetbirdState } from "@/lib/netbird";
import { requirePageSession } from "@/lib/session";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Tableau de bord" };

const NB_LABEL: Record<NetbirdState, { text: string; tone: "ok" | "amber" | "alert" | "neutral" }> = {
  connected: { text: "tunnel actif", tone: "ok" },
  registered: { text: "compte créé, tunnel inactif", tone: "amber" },
  absent: { text: "non configuré", tone: "alert" },
  unknown: { text: "état inconnu", tone: "neutral" },
};

export default async function DashboardPage() {
  const session = await requirePageSession();
  const api = getCtfd();
  const t = session.ctfdToken;
  const [me, challenges, instances, notifications, team, nb] = await Promise.allSettled([
    api.getMe(t),
    api.listChallenges(t),
    api.listInstances(t),
    api.getNotifications(t),
    api.getMyTeam(t),
    netbirdState(session.email),
  ]);
  const meV = me.status === "fulfilled" ? me.value : null;
  const chal = challenges.status === "fulfilled" ? challenges.value : [];
  const inst = instances.status === "fulfilled" ? instances.value : [];
  const notes = notifications.status === "fulfilled" ? notifications.value.slice(-3).reverse() : [];
  const teamV = team.status === "fulfilled" ? team.value : null;
  const solves = await api.getRecentSolves(t, meV?.teamId ?? null).catch(() => []);
  const nbState = nb.status === "fulfilled" ? nb.value : "unknown";
  const names = new Map(chal.map((c) => [c.id, c.name]));
  const solved = chal.filter((c) => c.solvedByMe).length;

  return (
    <>
      <PageHeader kicker={`opérateur ${session.name}`} title="Tableau de bord" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rang" value={meV?.place ? `#${meV.place}` : "—"} accent hint={teamV ? teamV.name : "pas d'équipe"} />
        <Stat label="Score" value={meV?.score ?? 0} hint="points de l'équipe" />
        <Stat label="Résolus" value={`${solved}/${chal.length}`} hint="challenges" />
        <Stat label="Instances" value={inst.length} hint="actives pour ton équipe" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Dernières résolutions" aside={<Link href="/challenges">challenges</Link>}>
          {solves.length === 0 ? (
            <EmptyState title="Rien encore">Aucune résolution pour ton équipe. Le premier flag est le plus dur.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {solves.slice(0, 6).map((s) => (
                <li key={`${s.challengeId}-${s.date}`} className="flex items-baseline gap-3 py-2 text-sm">
                  <span className="flex-1 truncate">
                    <Link href={`/challenges/${s.challengeId}`}>{s.challengeName}</Link>
                    <span className="ml-2 text-xs text-muted">{s.category}</span>
                  </span>
                  <span className="tabular font-display text-xl text-amber">+{s.value}</span>
                  <span className="hidden w-28 text-right text-xs text-muted sm:block">{formatRelative(s.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Instances actives" aside={<Link href="/instances">gérer</Link>}>
          {inst.length === 0 ? (
            <EmptyState title="Aucune instance">Lance une instance depuis la page d&apos;un challenge instancié.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {inst.map((i) => (
                <li key={i.challengeId} className="flex items-center gap-3 py-2 text-sm">
                  <Link href={`/challenges/${i.challengeId}`} className="flex-1 truncate">
                    {names.get(i.challengeId) ?? `#${i.challengeId}`}
                  </Link>
                  <code className="hidden truncate text-xs text-dim sm:block">{i.connectionInfo}</code>
                  <Countdown to={i.until} className="font-display text-xl" />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Tunnel NetBird" aside={<Badge tone={NB_LABEL[nbState].tone}>{NB_LABEL[nbState].text}</Badge>}>
          <p className="text-sm text-dim">
            Les instances ne répondent que depuis le VPN. {nbState === "connected" ? "Tu es prêt." : "Configure ton client avant de lancer une instance."}
          </p>
          <div className="mt-3">
            <ButtonLink href="/onboarding" variant="ghost" size="sm">
              Guide NetBird
            </ButtonLink>
          </div>
        </Panel>

        <Panel title="Annonces" aside={<Link href="/notifications">toutes</Link>}>
          {notes.length === 0 ? (
            <p className="text-sm text-muted">Pas d&apos;annonce.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id}>
                  <p className="text-sm text-fg">{n.title || "Annonce"}</p>
                  <p className="text-xs text-muted">{formatRelative(n.date)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {!teamV ? (
        <div className="mt-6 border border-amber/50 bg-amber/10 p-4 text-sm">
          Tu n&apos;as pas d&apos;équipe : les instances sont attribuées par équipe.{" "}
          <Link href="/team">Crée ou rejoins une équipe</Link>.
        </div>
      ) : null}
    </>
  );
}
