import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Règles" };

const RULES: { title: string; items: string[] }[] = [
  {
    title: "Fair-play",
    items: [
      "Une équipe = une instance par challenge. Ne partage ni flags, ni solutions, ni accès à ton instance avec une autre équipe.",
      "Les attaques contre l'infrastructure de la plateforme (front, CTFd, Authentik, NetBird, cluster) sont hors périmètre et entraînent une exclusion.",
      "Seules les adresses d'instances affichées dans ta console sont des cibles. Tout autre hôte est interdit.",
      "Pas de déni de service, de scan massif ni de brute force des flags : les soumissions sont limitées en nombre.",
    ],
  },
  {
    title: "Accès et instances",
    items: [
      "Les instances ne sont joignables qu'à travers le tunnel NetBird. Suis le guide « NetBird » de la console.",
      "Une instance a une durée de vie limitée ; tu peux la prolonger un nombre limité de fois. Elle est détruite à l'expiration.",
      "Le nombre d'instances simultanées par équipe est plafonné, avec un délai minimal entre deux lancements.",
    ],
  },
  {
    title: "Flags et score",
    items: [
      "Les flags ont le format PAD{...}. Respecte la casse sauf indication contraire.",
      "Certains challenges ont un nombre de tentatives limité. Les indices coûtent des points.",
      "Le scoreboard peut être gelé en fin d'événement : les soumissions restent comptées.",
    ],
  },
  {
    title: "Équipes",
    items: [
      "Crée une équipe ou rejoins-en une avec son nom et son mot de passe. Le créateur en est le capitaine.",
      "Un joueur qui a déjà marqué des points ne peut plus quitter son équipe.",
    ],
  },
];

export default function RulesPage() {
  return (
    <>
      <PageHeader kicker="règlement" title="Règles de l'opération" />
      <div className="grid gap-4 md:grid-cols-2">
        {RULES.map((r) => (
          <Panel key={r.title} title={r.title}>
            <ul className="list-[square] space-y-2 pl-5 text-sm text-dim marker:text-amber">
              {r.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
