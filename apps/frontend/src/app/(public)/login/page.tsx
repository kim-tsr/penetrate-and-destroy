import type { Metadata } from "next";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { isMockMode } from "@/lib/env";
import { safeCallbackPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Connexion" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Ton compte n'appartient à aucun groupe CTF (ctf-players, ctf-managers ou ctf-admins).",
  CredentialsSignin: "Identifiants de test invalides.",
  Configuration: "Le serveur d'authentification est mal configuré. Préviens les orgas.",
  Verification: "Le lien de connexion a expiré. Recommence.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const { error, callbackUrl } = await searchParams;
  const redirectTo = safeCallbackPath(callbackUrl);
  const mock = isMockMode();
  const hasOidc = Boolean(process.env.AUTH_AUTHENTIK_ISSUER);

  async function loginOidc() {
    "use server";
    await signIn("authentik", { redirectTo });
  }

  async function loginMock(formData: FormData) {
    "use server";
    try {
      await signIn("mock", {
        username: String(formData.get("username") ?? ""),
        role: String(formData.get("role") ?? "player"),
        redirectTo,
      });
    } catch (err) {
      if (err instanceof AuthError) redirect(`/login?error=${err.type}`);
      throw err;
    }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6 py-6 md:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col justify-center">
        <p className="label mb-2 text-amber">accès opérateur</p>
        <h1 className="text-6xl text-fg">Identifie-toi</h1>
        <p className="mt-4 max-w-sm text-sm text-dim">
          L&apos;authentification passe par le fournisseur d&apos;identité de la plateforme (Authentik). Ton rôle est déduit de tes groupes.
        </p>
      </div>
      <div className="space-y-4">
        {error ? <Notice tone="alert">{ERRORS[error] ?? "Connexion impossible. Réessaie ou contacte les orgas."}</Notice> : null}
        {hasOidc ? (
          <Panel title="Authentik (OIDC)">
            <form action={loginOidc}>
              <Button type="submit" size="lg" className="w-full">
                Se connecter
              </Button>
            </form>
          </Panel>
        ) : null}
        {mock ? (
          <Panel title="Connexion simulée" aside="PAD_MOCK=1">
            <form action={loginMock} className="space-y-4">
              <Notice tone="amber">Mode de développement : aucun compte réel, CTFd est simulé en mémoire.</Notice>
              <Field label="Pseudo" htmlFor="username">
                <Input id="username" name="username" defaultValue="ada" required minLength={2} maxLength={32} pattern="[\w.\-]+" autoComplete="off" />
              </Field>
              <Field label="Rôle" htmlFor="role">
                <select
                  id="role"
                  name="role"
                  defaultValue="player"
                  className="h-10 w-full border border-line-strong bg-bg px-3 text-sm text-fg focus:border-amber focus:outline-none"
                >
                  <option value="player">joueur</option>
                  <option value="manager">manager</option>
                  <option value="admin">admin</option>
                </select>
              </Field>
              <Button type="submit" size="lg" className="w-full">
                Entrer
              </Button>
            </form>
          </Panel>
        ) : null}
        {!hasOidc && !mock ? <Notice tone="alert">Aucun fournisseur d&apos;identité n&apos;est configuré.</Notice> : null}
      </div>
    </div>
  );
}
