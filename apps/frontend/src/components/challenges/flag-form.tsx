"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { ApiError, api } from "@/lib/client-api";
import type { AttemptResult } from "@/lib/ctfd/types";
import { cn } from "@/lib/utils";

const TONE: Record<AttemptResult["status"], string> = {
  correct: "border-ok text-ok",
  incorrect: "border-alert text-alert",
  already_solved: "border-info text-info",
  paused: "border-amber text-amber",
  ratelimited: "border-amber text-amber",
};

export function FlagForm({
  challengeId,
  solved,
  maxAttempts,
  attempts,
}: {
  challengeId: number;
  solved: boolean;
  maxAttempts: number;
  attempts: number;
}) {
  const router = useRouter();
  const [flag, setFlag] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: AttemptResult["status"]; message: string } | null>(null);
  const [done, setDone] = useState(solved);
  const [tries, setTries] = useState(attempts);
  const exhausted = maxAttempts > 0 && tries >= maxAttempts;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!flag.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api<AttemptResult>(`/api/challenges/${challengeId}/attempt`, { method: "POST", json: { submission: flag } });
      setResult(r);
      if (r.status === "correct") {
        setDone(true);
        setFlag("");
        toast.success("Flag validé", { description: r.message });
        router.refresh();
      } else if (r.status === "incorrect") {
        setTries((n) => n + 1);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setResult({ status: "ratelimited", message: `Trop de tentatives. Réessaie dans ${err.retryAfter ?? "quelques"} s.` });
      } else {
        setResult({ status: "paused", message: err instanceof Error ? err.message : "Erreur inconnue" });
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="border border-ok/60 bg-ok/10 px-4 py-3 text-sm text-ok" data-testid="solved-banner">
        Challenge résolu par ton équipe.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <label htmlFor="flag" className="label block">
        Flag
      </label>
      <div className="flex gap-2">
        <Input
          id="flag"
          name="flag"
          value={flag}
          onChange={(e) => setFlag(e.target.value)}
          placeholder="PAD{...}"
          autoComplete="off"
          spellCheck={false}
          maxLength={512}
          disabled={exhausted}
          aria-describedby="flag-result"
        />
        <Button type="submit" disabled={busy || exhausted || !flag.trim()}>
          {busy ? "…" : "Soumettre"}
        </Button>
      </div>
      {maxAttempts > 0 ? (
        <p className="text-xs text-muted">
          {Math.min(tries, maxAttempts)} / {maxAttempts} tentatives
        </p>
      ) : null}
      <div id="flag-result" aria-live="polite">
        {result ? (
          <p className={cn("border-l-2 bg-bg-raised px-3 py-2 text-sm", TONE[result.status])} data-testid="flag-result">
            {result.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
