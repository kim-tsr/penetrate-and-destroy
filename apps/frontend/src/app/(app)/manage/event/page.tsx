import type { Metadata } from "next";
import { EventForm } from "@/components/manage/event-form";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getCtfd } from "@/lib/ctfd/client";
import { cacheEvent } from "@/lib/event";
import { requirePageSession } from "@/lib/session";

export const metadata: Metadata = { title: "Événement · Manager" };

export default async function ManageEventPage() {
  const session = await requirePageSession("manager");
  const event = await getCtfd().getEvent(session.ctfdToken);
  await cacheEvent(event);
  return (
    <>
      <PageHeader kicker="portail manager" title="Événement" />
      <Panel title="Calendrier et état">
        <EventForm initial={event} />
      </Panel>
    </>
  );
}
