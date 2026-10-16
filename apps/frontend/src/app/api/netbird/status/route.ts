import { NextResponse } from "next/server";
import { enforceRateLimit, requireApiSession, route } from "@/lib/bff";
import { netbirdState } from "@/lib/netbird";

export const dynamic = "force-dynamic";

export const GET = route("netbird-status", async (req) => {
  const session = await requireApiSession(req);
  await enforceRateLimit(`nb:${session.userId}`, 12, 60);
  return NextResponse.json({ state: await netbirdState(session.email) });
});
