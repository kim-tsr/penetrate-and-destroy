import { NextResponse } from "next/server";
import { requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { cacheEvent } from "@/lib/event";
import { logger } from "@/lib/logger";
import { eventBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route("manage-event-get", async (req) => {
  const session = await requireApiSession(req, "manager");
  const event = await getCtfd().getEvent(session.ctfdToken);
  await cacheEvent(event);
  return NextResponse.json({ event });
});

export const PATCH = route("manage-event-patch", async (req) => {
  const session = await requireApiSession(req, "manager");
  const patch = eventBody.parse(await req.json().catch(() => null));
  const event = await getCtfd().updateEvent(session.ctfdToken, patch);
  await cacheEvent(event);
  logger.info({ userId: session.userId, state: event.state }, "événement modifié");
  return NextResponse.json({ event });
});
