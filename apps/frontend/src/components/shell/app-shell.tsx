import Link from "next/link";
import { Menu } from "lucide-react";
import { signOut } from "@/auth";
import { Countdown, UtcClock } from "@/components/clock";
import { NotificationsWatcher } from "@/components/notifications-watcher";
import { NavList, type NavItem } from "@/components/shell/nav";
import { Badge } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { EVENT_STATE_LABEL, type EventView } from "@/lib/event";
import { hasRole } from "@/lib/roles";
import type { ServerSession } from "@/lib/session";

const PLAYER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", code: "01" },
  { href: "/challenges", label: "Challenges", code: "02" },
  { href: "/instances", label: "Instances", code: "03" },
  { href: "/ranking", label: "Classement", code: "04" },
  { href: "/team", label: "Équipe", code: "05" },
  { href: "/notifications", label: "Annonces", code: "06" },
  { href: "/onboarding", label: "NetBird", code: "07" },
  { href: "/profile", label: "Profil", code: "08" },
];

const MANAGE_NAV: NavItem[] = [
  { href: "/manage", label: "Vue d'ensemble", code: "M1" },
  { href: "/manage/challenges", label: "Challenges", code: "M2" },
  { href: "/manage/import", label: "Import ZIP", code: "M3" },
  { href: "/manage/git", label: "Mode Git", code: "M4" },
  { href: "/manage/test-instance", label: "Test d'instance", code: "M5" },
  { href: "/manage/event", label: "Événement", code: "M6" },
  { href: "/manage/moderation", label: "Modération", code: "M7" },
];

const PHASE_TONE = { not_started: "info", running: "ok", paused: "amber", frozen: "info", ended: "alert" } as const;

export function AppShell({
  session,
  event,
  children,
}: {
  session: ServerSession;
  event: EventView;
  children: React.ReactNode;
}) {
  const isManager = hasRole(session.role, "manager");
  const target = event.state === "not_started" ? event.start : event.state === "ended" ? null : event.end;

  const nav = (
    <>
      <NavList title="Opérations" items={PLAYER_NAV} />
      {isManager ? <NavList title="Portail manager" items={MANAGE_NAV} /> : null}
    </>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <NotificationsWatcher />
      <aside className="hidden border-r border-line bg-bg-raised/80 lg:block">
        <div className="sticky top-0 flex h-dvh flex-col overflow-y-auto">
          <Link href="/dashboard" className="block border-b border-line px-5 py-5 no-underline hover:no-underline">
            <span className="block whitespace-nowrap font-display text-[1.65rem] font-black uppercase leading-none tracking-wide text-fg">
              Penetrate<span className="text-amber">&amp;</span>Destroy
            </span>
            <span className="label mt-2 block">salle d&apos;opérations</span>
          </Link>
          <div className="flex-1 px-2 pb-6">{nav}</div>
          <div className="border-t border-line p-4">
            <p className="truncate text-sm text-fg" title={session.name}>
              {session.name}
            </p>
            <p className="mb-3 mt-0.5 flex items-center gap-2">
              <Badge tone={session.role === "player" ? "neutral" : "amber"}>{session.role}</Badge>
            </p>
            <SignOutForm />
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2 text-xs sm:px-6">
            <details className="relative lg:hidden">
              <summary className="flex size-9 cursor-pointer list-none items-center justify-center border border-line-strong text-fg [&::-webkit-details-marker]:hidden" aria-label="Menu">
                <Menu className="size-4" />
              </summary>
              <div className="absolute left-0 top-11 max-h-[75dvh] w-64 overflow-y-auto border border-line-strong bg-bg-raised p-2 shadow-glow">
                {nav}
                <div className="mt-2 border-t border-line p-2">
                  <p className="mb-2 truncate text-sm">{session.name}</p>
                  <SignOutForm />
                </div>
              </div>
            </details>
            <span className="hidden font-display text-lg uppercase tracking-wider text-fg sm:inline">{event.name}</span>
            <Badge tone={PHASE_TONE[event.state]}>
              <span aria-hidden className="inline-block size-1.5 animate-pulse-amber rounded-full bg-current" />
              {EVENT_STATE_LABEL[event.state]}
            </Badge>
            {target ? (
              <span className="hidden items-center gap-2 text-dim sm:flex">
                {event.state === "not_started" ? "Début dans" : "Fin dans"}
                <Countdown to={target} className="text-amber" warnBelow={600} />
              </span>
            ) : null}
            <UtcClock className="ml-auto text-dim" />
          </div>
        </header>
        <main id="contenu" className="mx-auto w-full max-w-6xl animate-rise px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function SignOutForm() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button type="submit" variant="ghost" size="sm" className="w-full">
        Déconnexion
      </Button>
    </form>
  );
}
