"use client";
import { useSyncExternalStore } from "react";

/**
 * Horloge partagée (1 Hz) pour les compteurs et l'heure UTC. Renvoie 0 pendant le rendu serveur et
 * l'hydratation, puis l'heure courante : aucun écart d'hydratation, aucune lecture d'horloge au rendu.
 */
let snapshot = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    snapshot = Date.now();
    timer = setInterval(() => {
      snapshot = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => 0,
  );
}
