import { connection } from "next/server";
import { Countdown } from "@/components/clock";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import type { ScoreboardEntry } from "@/lib/ctfd/types";
import { getCtfd } from "@/lib/ctfd/client";
import { EVENT_STATE_LABEL, getEventView } from "@/lib/event";

async function topTeams(): Promise<ScoreboardEntry[] | null> {
  try {
    return (await getCtfd().getScoreboard(null)).slice(0, 5);
  } catch {
    return null; // scoreboard non public ou CTFd indisponible : la page reste utilisable
  }
}

const STEPS = [
  { n: "01", title: "Connexion", text: "Authentification unique via Authentik. Ton rôle (joueur, manager, admin) vient de tes groupes." },
  { n: "02", title: "Tunnel NetBird", text: "Les challenges ne sont joignables que depuis le VPN. Installe le client avant de lancer une instance." },
  { n: "03", title: "Instance d'équipe", text: "Chaque équipe lance, prolonge et arrête sa propre instance. Un compte à rebours te prévient avant l'expiration." },
  { n: "04", title: "Flags", text: "Soumets au format PAD{...}. Les tentatives sont limitées et journalisées." },
];

export default async function LandingPage() {
  await connection();
  const [event, top] = await Promise.all([getEventView(), topTeams()]);
  const target = event.state === "not_started" ? event.start : event.state === "ended" ? null : event.end;
  return (
    <div className="space-y-14">
      <section className="relative overflow-hidden border border-line bg-bg-raised/60 px-6 py-14 sm:px-12 sm:py-20">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 hatch opacity-60 md:block" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px animate-scan bg-amber/40" />
        <Badge tone="amber">{EVENT_STATE_LABEL[event.state]}</Badge>
        <h1 className="mt-5 max-w-3xl text-[clamp(3.5rem,11vw,8.5rem)] font-black leading-[0.88] text-fg">
          Penetrate
          <br />
          <span className="text-amber">&amp;</span> Destroy
        </h1>
        <p className="mt-6 max-w-xl text-base text-dim">
          Un CTF jetable, reconstruit à chaque édition. Challenges instanciés par équipe, joignables uniquement à travers le tunnel NetBird.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ButtonLink href="/login" size="lg">
            Entrer dans la salle
          </ButtonLink>
          <ButtonLink href="/rules" variant="ghost" size="lg">
            Lire les règles
          </ButtonLink>
          {target ? (
            <p className="ml-2 text-sm text-dim">
              {event.state === "not_started" ? "Ouverture dans " : "Clôture dans "}
              <Countdown to={target} className="text-lg text-amber" warnBelow={0} />
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="deroulement">
        <h2 id="deroulement" className="mb-5 text-3xl">
          Déroulé d&apos;une mission
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="panel p-4">
              <p className="tabular font-display text-5xl leading-none text-amber/80">{s.n}</p>
              <h3 className="mt-3 text-xl">{s.title}</h3>
              <p className="mt-2 text-sm text-dim">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {top && top.length > 0 ? (
        <Panel title="Tête du classement" aside={<a href="/scoreboard">scoreboard complet</a>}>
          <ol className="divide-y divide-line">
            {top.map((e) => (
              <li key={e.accountId} className="flex items-baseline gap-4 py-2">
                <span className="tabular w-8 font-display text-2xl text-amber">{e.pos}</span>
                <span className="flex-1 truncate text-fg">{e.name}</span>
                <span className="tabular font-display text-2xl">{e.score}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}
