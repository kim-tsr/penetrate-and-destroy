"use client";
import { useEffect } from "react";
import { toast } from "sonner";

const STORAGE_KEY = "pad:lastNotification";
const POLL_MS = 20_000;

function readLast(): number | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
function writeLast(id: number) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // stockage indisponible : on retombe sur la mémoire du composant
  }
}

/** Interroge les notifications CTFd et affiche un toast pour chaque nouvelle annonce. */
export function NotificationsWatcher() {
  useEffect(() => {
    let stopped = false;
    let memory = readLast();
    async function poll() {
      try {
        const res = await fetch(`/api/notifications?since=${memory ?? 0}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notifications: { id: number; title: string; content: string }[] };
        const list = data.notifications;
        if (!list.length) {
          if (memory === null) {
            memory = 0;
            writeLast(0);
          }
          return;
        }
        const max = Math.max(...list.map((n) => n.id));
        // Première visite : on mémorise l'historique sans l'afficher.
        if (memory !== null) {
          for (const n of list) {
            if (n.id > memory) toast(n.title || "Annonce", { description: n.content.replace(/<[^>]+>/g, "").slice(0, 280) });
          }
        }
        memory = Math.max(memory ?? 0, max);
        writeLast(memory);
      } catch {
        // réseau coupé : on réessaiera au prochain tour
      }
    }
    void poll();
    const t = setInterval(() => {
      if (!stopped && document.visibilityState === "visible") void poll();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);
  return null;
}
