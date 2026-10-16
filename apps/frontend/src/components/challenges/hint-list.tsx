"use client";
import { Lock, Unlock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { Hint } from "@/lib/ctfd/types";

export function HintList({ challengeId, hints }: { challengeId: number; hints: Hint[] }) {
  const [contents, setContents] = useState<Record<number, string>>(
    Object.fromEntries(hints.filter((h) => h.content != null).map((h) => [h.id, h.content as string])),
  );
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  if (hints.length === 0) return null;

  async function unlock(h: Hint) {
    if (confirming !== h.id) {
      setConfirming(h.id);
      return;
    }
    setBusy(h.id);
    try {
      const r = await api<{ id: number; content: string }>(`/api/challenges/${challengeId}/hints/${h.id}`, { method: "POST" });
      setContents((c) => ({ ...c, [h.id]: r.content }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Indice indisponible");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <ul className="space-y-2">
      {hints.map((h, i) => (
        <li key={h.id} className="border border-line bg-bg-raised p-3">
          {contents[h.id] !== undefined ? (
            <p className="flex gap-2 text-sm">
              <Unlock className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              <span>{contents[h.id]}</span>
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-dim">
                <Lock className="size-4" aria-hidden /> Indice {i + 1}
              </span>
              <Button size="sm" variant={confirming === h.id ? "danger" : "ghost"} disabled={busy === h.id} onClick={() => void unlock(h)}>
                {confirming === h.id ? `Confirmer −${h.cost} pts` : h.cost > 0 ? `Débloquer (−${h.cost} pts)` : "Débloquer"}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
