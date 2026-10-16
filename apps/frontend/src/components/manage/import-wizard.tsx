"use client";
import { CheckCircle2, FileArchive, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { inspectChallengeZip, MAX_ZIP_BYTES, type ZipPreview } from "@/lib/challenge-yml/parse-zip";
import { describeScoring } from "@/lib/challenge-yml/schema";
import { ApiError, api } from "@/lib/client-api";
import type { ImportResult } from "@/lib/ctfd/types";

/** Import d'un ZIP `challenge.yml` : validation locale immédiate, puis envoi au BFF (qui revalide). */
export function ImportWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ZipPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  const onDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0];
    setResult(null);
    setError(null);
    if (!f) return;
    setFile(f);
    setPreview(await inspectChallengeZip(f));
  }, []);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: MAX_ZIP_BYTES,
    accept: { "application/zip": [".zip"], "application/x-zip-compressed": [".zip"] },
  });

  async function upload() {
    if (!file || !preview?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file, file.name);
      const r = await api<{ result: ImportResult }>("/api/manage/import", { method: "POST", form });
      setResult(r.result);
      toast.success(r.result.action === "created" ? "Challenge créé" : "Challenge mis à jour", { description: r.result.name });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, details: err.details }
          : { message: "Erreur inconnue pendant l'import", details: [] },
      );
    } finally {
      setBusy(false);
    }
  }

  const c = preview?.challenge;
  return (
    <div className="space-y-6">
      <div
        {...getRootProps()}
        className={`hatch flex cursor-pointer flex-col items-center gap-3 border border-dashed px-6 py-12 text-center transition-colors ${
          isDragActive ? "border-amber bg-amber/10" : "border-line-strong hover:border-amber"
        }`}
      >
        <input {...getInputProps({ "aria-label": "Archive ZIP du challenge" })} />
        <FileArchive className="size-8 text-amber" aria-hidden />
        <p className="font-display text-2xl uppercase tracking-wide">Dépose une archive .zip</p>
        <p className="max-w-md text-xs text-muted">
          Un <code className="text-amber">challenge.yml</code> à la racine (ou dans un dossier unique) et les fichiers qu&apos;il référence. 50 Mo maximum.
        </p>
      </div>

      {fileRejections.length > 0 ? (
        <Notice tone="alert">{fileRejections[0]?.errors[0]?.message ?? "Fichier refusé"} ({fileRejections[0]?.file.name})</Notice>
      ) : null}

      {preview ? (
        <Panel
          title={`Aperçu · ${file?.name ?? ""}`}
          aside={preview.ok ? <Badge tone="ok">valide</Badge> : <Badge tone="alert">invalide</Badge>}
          data-testid="import-preview"
        >
          {!preview.ok ? (
            <ul className="space-y-1 text-sm">
              {preview.issues.map((i, idx) => (
                <li key={`${i.path}-${idx}`} className="flex gap-2 text-alert">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <code>{i.path}</code> : {i.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : c ? (
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Nom" value={c.name} />
              <Row label="Catégorie" value={c.category} />
              <Row label="Score" value={describeScoring(c)} />
              <Row label="État initial" value={c.state === "visible" ? "visible" : "masqué (à publier ensuite)"} />
              <Row label="Flags" value={String(c.flags.length)} />
              <Row label="Indices" value={String(c.hints.length)} />
              <Row label="Fichiers" value={c.files.length ? c.files.join(", ") : "aucun"} />
              <Row
                label="Instance"
                value={
                  c.instance
                    ? `${c.instance.image} · ports ${c.instance.ports.map((p) => (typeof p === "number" ? p : `${p.port}/${p.protocol}`)).join(", ")} · TTL ${c.instance.ttl} s`
                    : "statique (pas d'instance)"
                }
              />
            </dl>
          ) : null}
        </Panel>
      ) : null}

      {error ? (
        <Notice tone="alert">
          <p className="font-semibold">{error.message}</p>
          {error.details.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {error.details.map((d, i) => (
                <li key={`${d}-${i}`}>{d}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      {result ? (
        <Notice tone="ok">
          <p className="flex items-center gap-2 font-semibold" data-testid="import-success">
            <CheckCircle2 className="size-4" aria-hidden />
            {result.action === "created" ? "Challenge créé" : "Challenge mis à jour"} : {result.name} (#{result.id})
          </p>
          <p className="mt-1 text-xs text-dim">
            Type {result.type}, état {result.state}, {result.flags} flag(s), {result.filesUploaded.length} fichier(s) téléversé(s)
            {result.instance ? ", scénario chall-manager enregistré" : ""}.
          </p>
        </Notice>
      ) : null}

      <div className="flex gap-3">
        <Button onClick={() => void upload()} disabled={busy || !preview?.ok}>
          {busy ? "Import en cours…" : "Importer dans CTFd"}
        </Button>
        {file ? (
          <Button
            variant="quiet"
            onClick={() => {
              setFile(null);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
          >
            Réinitialiser
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="break-words text-fg">{value}</dd>
    </div>
  );
}
