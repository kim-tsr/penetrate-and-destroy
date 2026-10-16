import type { Metadata } from "next";
import { ChallengeBoard } from "@/components/challenges/challenge-board";
import { EmptyState, PageHeader } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { CtfdError } from "@/lib/ctfd/http";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Challenges" };

export default async function ChallengesPage() {
  const session = await requirePageSession();
  let challenges;
  try {
    challenges = await getCtfd().listChallenges(session.ctfdToken);
  } catch (err) {
    if (err instanceof CtfdError && err.status === 403) {
      return (
        <>
          <PageHeader kicker="missions" title="Challenges" />
          <EmptyState title="Opérations non ouvertes">Les challenges seront visibles dès l&apos;ouverture de l&apos;événement.</EmptyState>
        </>
      );
    }
    throw err;
  }
  return (
    <>
      <PageHeader kicker="missions" title="Challenges" />
      {challenges.length === 0 ? (
        <EmptyState title="Aucun challenge publié">Les managers n&apos;ont pas encore publié de challenge.</EmptyState>
      ) : (
        <ChallengeBoard challenges={challenges} />
      )}
    </>
  );
}
