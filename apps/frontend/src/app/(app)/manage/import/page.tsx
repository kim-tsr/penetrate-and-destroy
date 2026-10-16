import type { Metadata } from "next";
import Link from "next/link";
import { ImportWizard } from "@/components/manage/import-wizard";
import { PageHeader, Panel } from "@/components/ui/panel";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Import · Manager" };

export default async function ImportPage() {
  await requirePageSession("manager");
  return (
    <>
      <PageHeader kicker="portail manager" title="Import d'un challenge" />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <ImportWizard />
        <Panel title="Ce qui se passe à l'import">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-dim marker:text-amber">
            <li>Le ZIP est validé ici (schéma <code>challenge.yml</code>, chemins, fichiers présents), puis une seconde fois par CTFd.</li>
            <li>Les fichiers sont téléversés sur Garage (S3) par CTFd, sans renvoyer ceux qui n&apos;ont pas changé.</li>
            <li>Le challenge est créé ou mis à jour (clé : son nom). Il reste <strong>masqué</strong> sauf <code>state: visible</code>.</li>
            <li>Avec un bloc <code>instance</code>, le scénario est enregistré dans chall-manager. Si celui-ci est injoignable, rien n&apos;est créé.</li>
          </ol>
          <p className="mt-4 text-xs text-muted">
            Préfère le dépôt Git pour les imports en série : <Link href="/manage/git">mode Git</Link>.
          </p>
        </Panel>
      </div>
    </>
  );
}
