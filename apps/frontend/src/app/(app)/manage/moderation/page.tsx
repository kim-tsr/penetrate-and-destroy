import type { Metadata } from "next";
import { AwardsModeration, SubmissionsModeration, TeamsModeration, UsersModeration } from "@/components/manage/moderation-table";
import { Input } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Modération · Manager" };

const PER_PAGE = 200;

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requirePageSession("manager");
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const api = getCtfd();
  const t = session.ctfdToken;
  const [users, teams, solves, awards] = await Promise.all([
    api.listUsers(t, { q, perPage: PER_PAGE }),
    api.listTeams(t, { q, perPage: PER_PAGE }),
    api.listSubmissions(t, { type: "correct", perPage: 50 }),
    api.listAwards(t, { perPage: 50 }),
  ]);
  const more = (shown: number, total: number) => (total > shown ? ` · ${shown} affichés, affine la recherche` : "");
  return (
    <>
      <PageHeader kicker="portail manager" title="Modération" />
      <form method="get" className="mb-6 flex max-w-md gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Rechercher un joueur ou une équipe" aria-label="Rechercher un joueur ou une équipe" maxLength={100} />
        <button type="submit" className="border border-line-strong px-3 text-sm hover:border-amber">
          Chercher
        </button>
      </form>
      <div className="space-y-6">
        <Panel title={`Équipes (${teams.total})${more(teams.items.length, teams.total)}`} bodyClassName="p-0">
          <TeamsModeration teams={teams.items} />
        </Panel>
        <Panel title={`Joueurs (${users.total})${more(users.items.length, users.total)}`} bodyClassName="p-0">
          <UsersModeration users={users.items} />
        </Panel>
        <Panel title="Résolutions récentes (invalidation)" bodyClassName="p-0">
          <SubmissionsModeration submissions={solves.items} />
        </Panel>
        <Panel title={`Awards (${awards.total})`} bodyClassName="p-0">
          <AwardsModeration awards={awards.items} />
        </Panel>
      </div>
    </>
  );
}
