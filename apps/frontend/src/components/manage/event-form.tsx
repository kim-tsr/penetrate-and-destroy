"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Field, Input, Notice } from "@/components/ui/form";
import { ApiError, api } from "@/lib/client-api";
import type { EventConfig, EventState } from "@/lib/ctfd/types";
import { EVENT_STATE_LABEL } from "@/lib/event-labels";

/** ISO UTC -> valeur d'un <input type="datetime-local"> (interprétée en UTC dans ce formulaire). */
const toLocal = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
const toIso = (local: string) => (local ? new Date(`${local}:00Z`).toISOString() : null);

const TONE: Record<EventState, "ok" | "amber" | "alert" | "info"> = {
  running: "ok",
  paused: "amber",
  frozen: "info",
  ended: "alert",
  not_started: "info",
};

export function EventForm({ initial }: { initial: EventConfig }) {
  const [event, setEvent] = useState(initial);
  const [start, setStart] = useState(toLocal(initial.start));
  const [end, setEnd] = useState(toLocal(initial.end));
  const [freeze, setFreeze] = useState(toLocal(initial.freeze));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ event: EventConfig }>("/api/manage/event", { method: "PATCH", json: body });
      setEvent(r.event);
      setStart(toLocal(r.event.start));
      setEnd(toLocal(r.event.end));
      setFreeze(toLocal(r.event.freeze));
      toast.success(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const s = toIso(start);
    const en = toIso(end);
    const f = toIso(freeze);
    if (s && en && s >= en) return setError("Le début doit précéder la fin.");
    if (f && ((s && f < s) || (en && f > en))) return setError("Le gel du scoreboard doit tomber entre le début et la fin.");
    void patch({ start: s, end: en, freeze: f }, "Calendrier enregistré");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={TONE[event.state]} data-testid="event-state">
          {EVENT_STATE_LABEL[event.state]}
        </Badge>
        <Button
          variant={event.paused ? "primary" : "ghost"}
          size="sm"
          disabled={busy}
          onClick={() => void patch({ paused: !event.paused }, event.paused ? "Événement repris" : "Événement mis en pause")}
        >
          {event.paused ? "Reprendre l'événement" : "Mettre en pause"}
        </Button>
        <span className="text-xs text-muted">La pause bloque les soumissions et les lancements d&apos;instances (hors managers).</span>
      </div>

      <form onSubmit={save} className="grid gap-4 sm:grid-cols-3" noValidate>
        {error ? <Notice tone="alert" className="sm:col-span-3">{error}</Notice> : null}
        <Field label="Début (UTC)" htmlFor="ev-start">
          <Input id="ev-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Fin (UTC)" htmlFor="ev-end">
          <Input id="ev-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Gel du scoreboard (UTC)" htmlFor="ev-freeze" hint="Vide = pas de gel.">
          <Input id="ev-freeze" type="datetime-local" value={freeze} onChange={(e) => setFreeze(e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={busy}>
            Enregistrer le calendrier
          </Button>
        </div>
      </form>
    </div>
  );
}
