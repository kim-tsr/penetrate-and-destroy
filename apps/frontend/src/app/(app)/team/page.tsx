import type { Metadata } from "next";
import { Badge } from "@/components/ui/form";
import { PageHeader, Panel, Stat } from "@/components/ui/panel";
import { LeaveTeamButton, TeamForms } from "@/components/team/team-forms";
import { getCtfd } from "@/lib/ctfd/client";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Équipe" };

export default async function TeamPage() {
  const session = await requirePageSession();
  const team = await getCtfd().getMyTeam(session.ctfdToken);

  if (!team) {
    return (
      <>
        <PageHeader kicker="effectif" title="Équipe" />
        <p className="mb-6 max-w-prose text-sm text-dim">
          Les instances de challenges sont attribuées par équipe. Crée la tienne ou rejoins celle de tes coéquipiers avec son nom et son mot de passe.
        </p>
        <TeamForms />
      </>
    );
  }
  return (
    <>
      <PageHeader kicker="effectif" title={team.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Score" value={team.score} accent />
        <Stat label="Rang" value={team.place ? `#${team.place}` : "—"} />
      </div>
      <Panel title="Membres" className="mt-6" bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {team.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="flex-1 truncate">{m.name}</span>
              {m.id === team.captainId ? <Badge tone="amber">capitaine</Badge> : null}
              {m.id === session.userId ? <Badge>toi</Badge> : null}
              <span className="tabular font-display text-xl">{m.score}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Zone sensible" className="mt-6">
        <p className="mb-3 text-sm text-dim">
          Quitter l&apos;équipe est impossible après avoir marqué des points, ou en tant que capitaine tant qu&apos;il reste des membres.
        </p>
        <LeaveTeamButton />
      </Panel>
    </>
  );
}
