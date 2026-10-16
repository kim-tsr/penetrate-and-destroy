"use client";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusScreen
      code="500"
      title="Perte de liaison"
      action={<Button onClick={reset}>Réessayer</Button>}
    >
      Le moteur CTF ne répond pas comme prévu. Réessaie dans un instant.
      {error.digest ? <span className="mt-2 block text-xs text-muted">réf. {error.digest}</span> : null}
    </StatusScreen>
  );
}
