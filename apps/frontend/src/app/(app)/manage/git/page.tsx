import type { Metadata } from "next";
import { Badge, Notice } from "@/components/ui/form";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { getGitSyncStatus } from "@/lib/git-sync";
import { requirePageSession } from "@/lib/session";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Mode Git · Manager" };

const STATUS_TONE = { created: "ok", updated: "info", unchanged: "neutral", failed: "alert" } as const;

export default async function GitModePage() {
  const session = await requirePageSession("manager");
  const [sync, managed] = await Promise.all([getGitSyncStatus(), getCtfd().listManagedChallenges(session.ctfdToken)]);
  const repo = process.env.PAD_GIT_REPO_URL;
  return (
    <>
      <PageHeader kicker="portail manager" title="Mode Git" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Fonctionnement">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-dim marker:text-amber">
            <li>
              Chaque challenge vit dans <code>challenges/&lt;nom&gt;/challenge.yml</code> du dépôt
              {repo ? (
                <>
                  {" "}
                  (<code>{repo}</code>)
                </>
              ) : null}
              , validé en CI par le schéma <code>challenges/schema/challenge.schema.json</code>.
            </li>
            <li>
              À chaque merge sur la branche principale, la CI archive chaque dossier modifié et l&apos;envoie à{" "}
              <code>POST /api/v1/manager/challenges/import</code> (script <code>challenges/sync.sh</code>).
            </li>
            <li>L&apos;import est idempotent (clé : nom du challenge) : relancer la synchro ne duplique rien.</li>
            <li>Les modifications faites à la main dans CTFd sont écrasées au prochain import du même challenge.</li>
          </ol>
          <pre className="mt-4 overflow-x-auto border border-line bg-bg p-3 text-xs text-amber">
            {`PAD_CTFD_URL=<url interne de CTFd> \\
PAD_CTFD_TOKEN=<token manager> \\
./challenges/sync.sh challenges/<nom>`}
          </pre>
        </Panel>

        <Panel
          title="Statut de la dernière synchro"
          aside={
            sync.state === "ok" ? <Badge tone="ok">{formatRelative(sync.status.syncedAt)}</Badge> : <Badge tone="neutral">{sync.state}</Badge>
          }
        >
          {sync.state === "unconfigured" ? (
            <Notice tone="info">
              Aucun statut publié. Définis <code>PAD_GIT_SYNC_STATUS_URL</code> vers le JSON produit par la CI (commit, branche, résultat par
              challenge).
            </Notice>
          ) : sync.state === "unavailable" ? (
            <Notice tone="alert">Statut injoignable : {sync.reason}.</Notice>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                Commit <code className="text-amber">{sync.status.commit.slice(0, 12)}</code> sur <code>{sync.status.branch}</code>
              </p>
              <ul className="divide-y divide-line">
                {sync.status.results.map((r) => (
                  <li key={r.name} className="flex items-center gap-3 py-1.5">
                    <span className="flex-1 truncate">{r.name}</span>
                    {r.message ? <span className="hidden truncate text-xs text-muted sm:block">{r.message}</span> : null}
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel title={`Challenges présents dans CTFd (${managed.items.length})`} className="mt-6" bodyClassName="p-0">
        <ul className="divide-y divide-line text-sm">
          {managed.items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted">{c.category}</span>
              <Badge tone={c.state === "visible" ? "ok" : "amber"}>{c.state}</Badge>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
