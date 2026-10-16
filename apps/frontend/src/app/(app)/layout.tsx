import { AppShell } from "@/components/shell/app-shell";
import { getEventView } from "@/lib/event";
import { requirePageSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  const event = await getEventView(session);
  return (
    <AppShell session={session} event={event}>
      {children}
    </AppShell>
  );
}
