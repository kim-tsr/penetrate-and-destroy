"use client";
import { useEffect, useState } from "react";
import { ScoreChart } from "@/components/scoreboard/score-chart";
import { Badge } from "@/components/ui/form";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { ScoreSeries, ScoreboardEntry } from "@/lib/ctfd/types";
import { cn } from "@/lib/utils";

interface Payload {
  entries: ScoreboardEntry[];
  series: ScoreSeries[];
  at: number;
}

type Status = "connecting" | "live" | "retrying" | "private";

/**
 * Scoreboard temps réel : le serveur pousse un instantané (SSE) à chaque changement ;
 * `initial` évite un écran vide avant l'ouverture du flux.
 */
export function LiveScoreboard({ initial, highlight }: { initial: Payload | null; highlight?: string | null }) {
  const [data, setData] = useState<Payload | null>(initial);
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const es = new EventSource("/api/scoreboard/stream");
    es.addEventListener("open", () => setStatus("live"));
    es.addEventListener("scoreboard", (e) => {
      setData(JSON.parse((e as MessageEvent<string>).data) as Payload);
      setStatus("live");
    });
    es.addEventListener("unavailable", () => {
      setStatus("private");
      es.close();
    });
    es.addEventListener("error", () => setStatus((s) => (s === "private" ? s : "retrying")));
    return () => es.close();
  }, []);

  if (status === "private" && !data) {
    return (
      <EmptyState title="Scoreboard non public">
        Les orgas ont réservé le classement aux joueurs connectés. Connecte-toi pour le consulter.
      </EmptyState>
    );
  }

  const entries = data?.entries ?? [];
  return (
    <div className="space-y-4">
      <Panel
        title="Classement"
        aside={
          <Badge tone={status === "live" ? "ok" : status === "private" ? "alert" : "amber"} data-testid="scoreboard-status">
            <span aria-hidden className={cn("inline-block size-1.5 rounded-full bg-current", status === "live" && "animate-pulse-amber")} />
            {status === "live" ? "direct" : status === "connecting" ? "connexion" : status === "private" ? "privé" : "reconnexion"}
          </Badge>
        }
        bodyClassName="p-0"
      >
        {entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">Aucun score pour le moment.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Classement des équipes</caption>
            <thead>
              <tr className="label border-b border-line text-left">
                <th scope="col" className="w-16 px-4 py-2 font-normal">
                  #
                </th>
                <th scope="col" className="px-2 py-2 font-normal">
                  Équipe
                </th>
                <th scope="col" className="hidden px-2 py-2 font-normal sm:table-cell">
                  Membres
                </th>
                <th scope="col" className="px-4 py-2 text-right font-normal">
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.accountId}
                  data-testid="scoreboard-row"
                  className={cn(
                    "border-b border-line/60 last:border-0",
                    highlight && e.name === highlight ? "bg-amber/10" : "hover:bg-panel-hi",
                  )}
                >
                  <td className={cn("tabular px-4 py-2 font-display text-2xl", e.pos <= 3 ? "text-amber" : "text-dim")}>{e.pos}</td>
                  <td className="px-2 py-2 text-fg">
                    {e.name}
                    {highlight && e.name === highlight ? <Badge tone="amber" className="ml-2">toi</Badge> : null}
                  </td>
                  <td className="tabular hidden px-2 py-2 text-muted sm:table-cell">{e.memberCount}</td>
                  <td className="tabular px-4 py-2 text-right font-display text-2xl text-fg">{e.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Progression">
        <ScoreChart series={data?.series ?? []} until={data?.at ?? 0} />
      </Panel>
    </div>
  );
}
