import type { Metadata } from "next";
import { NetbirdCheck } from "@/components/netbird-check";
import { PageHeader, Panel } from "@/components/ui/panel";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "NetBird" };

function Cmd({ children }: { children: string }) {
  return <pre className="overflow-x-auto border border-line bg-bg px-3 py-2 text-sm text-amber">{children}</pre>;
}

export default async function OnboardingPage() {
  await requirePageSession();
  // URL de management publiée par les orgas (contracts: netbird.api_url sans /api) ; placeholder sinon.
  const management = process.env.NETBIRD_MANAGEMENT_URL ?? "https://vpn.CHANGEME.example.net";
  return (
    <>
      <PageHeader kicker="accès aux instances" title="Onboarding NetBird" />
      <p className="mb-6 max-w-prose text-sm text-dim">
        Les instances de challenges ne sont pas exposées sur Internet : elles ne répondent qu&apos;aux pairs NetBird de ton équipe. Quatre étapes.
      </p>
      <ol className="space-y-6">
        <li>
          <Panel title="01 · Installer le client">
            <p className="mb-3 text-sm text-dim">
              Linux, macOS et Windows sont supportés. Voir la documentation officielle sur{" "}
              <a href="https://docs.netbird.io/how-to/getting-started" target="_blank" rel="noopener noreferrer">
                docs.netbird.io
              </a>
              . Sous Linux :
            </p>
            <Cmd>curl -fsSL https://pkgs.netbird.io/install.sh | sh</Cmd>
          </Panel>
        </li>
        <li>
          <Panel title="02 · Se connecter au serveur de la plateforme">
            <p className="mb-3 text-sm text-dim">
              Utilise le serveur de management de l&apos;événement ; une fenêtre de navigateur s&apos;ouvre pour t&apos;authentifier avec le même compte Authentik.
            </p>
            <Cmd>{`netbird up --management-url ${management}`}</Cmd>
          </Panel>
        </li>
        <li>
          <Panel title="03 · Vérifier">
            <p className="mb-3 text-sm text-dim">
              <code className="text-amber">netbird status</code> doit afficher <em>Connected</em>. Tu peux aussi vérifier d&apos;ici :
            </p>
            <NetbirdCheck />
          </Panel>
        </li>
        <li>
          <Panel title="04 · Lancer une instance">
            <p className="text-sm text-dim">
              Dans la page d&apos;un challenge instancié, lance l&apos;instance de ton équipe puis copie l&apos;adresse affichée. Si elle ne répond pas : vérifie
              le tunnel, que ton équipe est bien constituée (page Équipe), puis patiente quelques secondes le temps que les règles d&apos;accès NetBird se propagent.
            </p>
          </Panel>
        </li>
      </ol>
    </>
  );
}
