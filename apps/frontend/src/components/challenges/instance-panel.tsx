"use client";
import { Copy, Loader2, Play, RefreshCw, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Countdown } from "@/components/clock";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/form";
import { api } from "@/lib/client-api";
import type { Instance } from "@/lib/ctfd/types";
import { useNow } from "@/lib/use-now";

type Action = "start" | "extend" | "stop";
const POLL_MS = 15_000;

/** Pilotage de l'instance d'une équipe : lancer, prolonger, arrêter, avec compte à rebours et rappel NetBird. */
export function InstancePanel({ challengeId, initial }: { challengeId: number; initial: Instance | null }) {
  const [instance, setInstance] = useState<Instance | null>(initial);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  // Resynchronisation périodique : l'instance peut être arrêtée par un coéquipier ou expirer.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api<{ instance: Instance | null }>(`/api/instances/${challengeId}`);
        setInstance((cur) => (busy ? cur : r.instance));
      } catch {
        // erreur transitoire : le prochain tour réessaiera
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [challengeId, busy]);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    try {
      const method = action === "start" ? "POST" : action === "extend" ? "PATCH" : "DELETE";
      const r = await api<{ instance: Instance | null }>(`/api/instances/${challengeId}`, { method });
      setInstance(r.instance);
      if (action === "start") toast.success("Instance prête", { description: "Active ton tunnel NetBird avant de te connecter." });
      if (action === "extend") toast.success("Instance prolongée");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copié");
    } catch {
      toast.error("Copie impossible, sélectionne le texte à la main");
    }
  }

  const until = instance?.until ? Date.parse(instance.until) : null;
  const since = instance?.since ? Date.parse(instance.since) : null;
  const expired = !!now && until !== null && now >= until;
  const progress =
    now && until && since && until > since ? Math.min(100, Math.max(0, ((until - now) / (until - since)) * 100)) : 100;
  const canExtend = instance?.renewalsLeft == null || instance.renewalsLeft > 0;

  return (
    <div className="space-y-4" data-testid="instance-panel">
      {error ? <Notice tone="alert">{error}</Notice> : null}

      {!instance ? (
        <div className="space-y-3">
          <p className="text-sm text-dim">Aucune instance en cours pour ton équipe.</p>
          <Button onClick={() => void run("start")} disabled={busy !== null} className="w-full">
            {busy === "start" ? <Loader2 className="animate-spin" /> : <Play />}
            {busy === "start" ? "Déploiement en cours…" : "Lancer l'instance"}
          </Button>
          {busy === "start" ? <p className="text-xs text-muted">Le déploiement peut prendre une à deux minutes.</p> : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="label mb-1">Connexion</p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 break-all border border-line-strong bg-bg px-3 py-2 text-sm text-amber" data-testid="connection-info">
                {instance.connectionInfo ?? "adresse en cours d'attribution…"}
              </code>
              {instance.connectionInfo ? (
                <Button variant="ghost" size="sm" className="h-auto" onClick={() => void copy(instance.connectionInfo!)} aria-label="Copier l'adresse">
                  <Copy />
                </Button>
              ) : null}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <p className="label">{expired ? "Expirée" : "Expire dans"}</p>
              <p className="tabular font-display text-4xl leading-none text-fg">
                <Countdown to={instance.until} warnBelow={300} />
              </p>
            </div>
            <div className="mt-2 h-1.5 w-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
              <div className="h-full bg-amber transition-[width] duration-1000" style={{ width: `${progress}%` }} />
            </div>
            {instance.maxRenewals != null ? (
              <p className="mt-2 text-xs text-muted">
                Prolongations : {instance.renewals} / {instance.maxRenewals}
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={busy !== null || !canExtend} onClick={() => void run("extend")}>
              {busy === "extend" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Prolonger
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy !== null} onClick={() => void run("stop")}>
              {busy === "stop" ? <Loader2 className="animate-spin" /> : <Square />}
              Arrêter
            </Button>
          </div>

          <Notice tone="amber">
            Cette adresse n&apos;est joignable que <strong>connecté à NetBird</strong>. Pas encore configuré ?{" "}
            <Link href="/onboarding">Guide d&apos;installation</Link>.
          </Notice>
        </div>
      )}
    </div>
  );
}
