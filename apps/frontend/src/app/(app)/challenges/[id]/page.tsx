import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagForm } from "@/components/challenges/flag-form";
import { HintList } from "@/components/challenges/hint-list";
import { InstancePanel } from "@/components/challenges/instance-panel";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { CtfdError } from "@/lib/ctfd/http";
import { idParam } from "@/lib/schemas";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Challenge" };

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  const parsed = idParam.safeParse(await params);
  if (!parsed.success) notFound();
  const { id } = parsed.data;

  let challenge;
  try {
    challenge = await getCtfd().getChallenge(session.ctfdToken, id);
  } catch (err) {
    if (err instanceof CtfdError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  const instance = challenge.instanced ? await getCtfd().getInstance(session.ctfdToken, id).catch(() => null) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/challenges" className="label text-dim no-underline hover:text-amber hover:no-underline">
          ← Challenges
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="label mb-1 flex items-center gap-2 text-amber">
              {challenge.category}
              {challenge.solvedByMe ? <Badge tone="ok">résolu</Badge> : null}
            </p>
            <h1 className="text-4xl sm:text-5xl">{challenge.name}</h1>
          </div>
          <p className="tabular font-display text-6xl leading-none text-amber">
            {challenge.value}
            <span className="ml-1 font-mono text-sm text-muted">pts</span>
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Briefing">
            <Markdown>{challenge.description}</Markdown>
            {challenge.connectionInfo ? (
              <p className="mt-4 border-t border-line pt-3 text-sm">
                <span className="label mr-2">Connexion</span>
                <code className="text-amber">{challenge.connectionInfo}</code>
              </p>
            ) : null}
            {challenge.tags.filter((t) => !t.toLowerCase().startsWith("difficulty:")).length ? (
              <p className="mt-4 flex flex-wrap gap-1">
                {challenge.tags
                  .filter((t) => !t.toLowerCase().startsWith("difficulty:"))
                  .map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
              </p>
            ) : null}
          </Panel>

          {challenge.files.length ? (
            <Panel title="Fichiers">
              <ul className="space-y-1">
                {challenge.files.map((f) => (
                  <li key={f.href}>
                    <a href={f.href} download className="inline-flex items-center gap-2 text-sm">
                      <Download className="size-4" aria-hidden /> {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {challenge.hints.length ? (
            <Panel title="Indices">
              <HintList challengeId={challenge.id} hints={challenge.hints} />
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          <Panel title="Soumission">
            <FlagForm
              challengeId={challenge.id}
              solved={challenge.solvedByMe}
              maxAttempts={challenge.maxAttempts}
              attempts={challenge.attempts}
            />
            <p className="mt-3 text-xs text-muted">
              {challenge.solves} équipe{challenge.solves > 1 ? "s" : ""} ont résolu ce challenge.
            </p>
            {challenge.firstBloodBy ? (
              <p data-testid="first-blood" className="mt-2 text-xs text-muted">
                <span className="label mr-2 text-alert">First blood</span>
                {challenge.firstBloodBy.accountName}
                {challenge.firstBloodBy.userName && challenge.firstBloodBy.userName !== challenge.firstBloodBy.accountName
                  ? ` (${challenge.firstBloodBy.userName})`
                  : ""}
                {" · "}
                {new Date(challenge.firstBloodBy.date).toLocaleString("fr-FR", { timeZone: "UTC" })} UTC
              </p>
            ) : null}
          </Panel>
          {challenge.instanced ? (
            <Panel title="Instance d'équipe">
              <InstancePanel challengeId={challenge.id} initial={instance} />
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
