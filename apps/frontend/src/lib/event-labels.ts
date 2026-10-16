import type { EventState } from "./ctfd/types";

/** Libellés partagés serveur/client des phases de l'événement. */
export const EVENT_STATE_LABEL: Record<EventState, string> = {
  not_started: "Pas commencé",
  running: "En cours",
  paused: "En pause",
  frozen: "Scoreboard gelé",
  ended: "Terminé",
};
