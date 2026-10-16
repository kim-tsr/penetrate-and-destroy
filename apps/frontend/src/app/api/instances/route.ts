import { NextResponse } from "next/server";
import { requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";

export const dynamic = "force-dynamic";

export const GET = route("instances-list", async (req) => {
  const session = await requireApiSession(req);
  return NextResponse.json({ instances: await getCtfd().listInstances(session.ctfdToken) });
});
