import { NextResponse } from "next/server";
import { requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { notificationsQuery } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route("notifications", async (req) => {
  const session = await requireApiSession(req);
  const { since } = notificationsQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const notifications = await getCtfd().getNotifications(session.ctfdToken, since || undefined);
  return NextResponse.json({ notifications });
});
