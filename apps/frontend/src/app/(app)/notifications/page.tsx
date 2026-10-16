import type { Metadata } from "next";
import { Markdown } from "@/components/markdown";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { requirePageSession } from "@/lib/session";
import { formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Annonces" };

export default async function NotificationsPage() {
  const session = await requirePageSession();
  const notifications = (await getCtfd().getNotifications(session.ctfdToken)).reverse();
  return (
    <>
      <PageHeader kicker="canal des orgas" title="Annonces" />
      {notifications.length === 0 ? (
        <EmptyState title="Silence radio">Les annonces des organisateurs apparaîtront ici (et en notification).</EmptyState>
      ) : (
        <ul className="space-y-4">
          {notifications.map((n) => (
            <li key={n.id}>
              <Panel title={n.title || "Annonce"} aside={formatRelative(n.date)}>
                <Markdown>{n.content}</Markdown>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
