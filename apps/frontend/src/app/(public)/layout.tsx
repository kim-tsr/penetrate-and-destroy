import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { eventName } from "@/lib/event";
import { getServerSession } from "@/lib/session";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession().catch(() => null);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="font-display text-2xl font-black uppercase tracking-wide text-fg no-underline hover:no-underline">
            P<span className="text-amber">&amp;</span>D
            <span className="ml-3 hidden text-sm font-medium tracking-[0.2em] text-muted sm:inline">{eventName()}</span>
          </Link>
          <nav aria-label="Navigation publique" className="ml-auto flex items-center gap-1 text-xs uppercase tracking-[0.14em]">
            <Link href="/rules" className="px-3 py-2 text-dim no-underline hover:text-amber hover:no-underline">
              Règles
            </Link>
            <Link href="/scoreboard" className="px-3 py-2 text-dim no-underline hover:text-amber hover:no-underline">
              Scoreboard
            </Link>
            {session ? (
              <ButtonLink href="/dashboard" size="sm">
                Ouvrir la console
              </ButtonLink>
            ) : (
              <ButtonLink href="/login" size="sm">
                Se connecter
              </ButtonLink>
            )}
          </nav>
        </div>
      </header>
      <main id="contenu" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        PenetrateAndDestroy · challenges accessibles uniquement via NetBird · logs et flags surveillés
      </footer>
    </div>
  );
}
