"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/form";
import { api } from "@/lib/client-api";

type State = "connected" | "registered" | "absent" | "unknown";

const VIEW: Record<State, { tone: "ok" | "amber" | "alert" | "neutral"; text: string }> = {
  connected: { tone: "ok", text: "Tunnel actif : tu peux atteindre les instances." },
  registered: { tone: "amber", text: "Compte NetBird trouvé, mais aucun appareil connecté. Lance `netbird up`." },
  absent: { tone: "alert", text: "Aucun compte NetBird pour ton e-mail. Suis les étapes 1 et 2." },
  unknown: { tone: "neutral", text: "Vérification automatique indisponible. Utilise `netbird status` sur ta machine." },
};

export function NetbirdCheck() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      setState((await api<{ state: State }>("/api/netbird/status")).state);
    } catch {
      setState("unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={() => void check()} disabled={busy} variant="ghost">
        {busy ? "Vérification…" : "Vérifier ma connexion"}
      </Button>
      {state ? (
        <p aria-live="polite" data-testid="netbird-state" className="flex items-center gap-2 text-sm">
          <Badge tone={VIEW[state].tone}>{state}</Badge>
          {VIEW[state].text}
        </p>
      ) : null}
    </div>
  );
}
