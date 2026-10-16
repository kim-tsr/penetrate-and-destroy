import { NextResponse } from "next/server";
import { requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { idParam, statsQuery } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route("manage-stats", async (req, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireApiSession(req, "manager");
  const { id } = idParam.parse(await ctx.params);
  const { bucket } = statsQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ stats: await getCtfd().getChallengeStats(session.ctfdToken, id, bucket) });
});
