"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { ApiError, api } from "@/lib/client-api";
import { teamCredentials } from "@/lib/schemas";

function CredentialsForm({
  mode,
  title,
  submitLabel,
  endpoint,
  success,
}: {
  mode: "create" | "join";
  title: string;
  submitLabel: string;
  endpoint: string;
  success: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; password?: string }>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = teamCredentials.safeParse({ name: form.get("name"), password: form.get("password") });
    if (!parsed.success) {
      const f: { name?: string; password?: string } = {};
      for (const i of parsed.error.issues) f[i.path[0] as "name" | "password"] ??= i.message;
      setFieldErrors(f);
      return;
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      await api(endpoint, { method: "POST", json: parsed.data });
      toast.success(success);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={title}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <Notice tone="alert">{error}</Notice> : null}
        <Field label="Nom de l'équipe" htmlFor={`${mode}-name`} error={fieldErrors.name}>
          <Input id={`${mode}-name`} name="name" maxLength={128} autoComplete="off" required />
        </Field>
        <Field
          label="Mot de passe d'équipe"
          htmlFor={`${mode}-password`}
          hint={mode === "create" ? "Partage-le à tes coéquipiers pour qu'ils te rejoignent." : undefined}
          error={fieldErrors.password}
        >
          <Input id={`${mode}-password`} name="password" type="password" maxLength={128} autoComplete="new-password" required />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "…" : submitLabel}
        </Button>
      </form>
    </Panel>
  );
}

export function TeamForms() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CredentialsForm mode="create" title="Créer une équipe" submitLabel="Créer" endpoint="/api/team" success="Équipe créée" />
      <CredentialsForm mode="join" title="Rejoindre une équipe" submitLabel="Rejoindre" endpoint="/api/team/join" success="Équipe rejointe" />
    </div>
  );
}

export function LeaveTeamButton() {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/team", { method: "DELETE" });
      toast.success("Tu as quitté l'équipe");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Notice tone="alert">{error}</Notice> : null}
      <Button variant="danger" onClick={() => void leave()} disabled={busy}>
        {confirm ? "Confirmer le départ" : "Quitter l'équipe"}
      </Button>
    </div>
  );
}
