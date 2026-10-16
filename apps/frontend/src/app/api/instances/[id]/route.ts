import { NextResponse } from "next/server";
import { enforceRateLimit, requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { idParam } from "@/lib/schemas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Instance courante de l'équipe pour ce challenge (`instance: null` si absente). */
export const GET = route("instance-get", async (req, ctx: Ctx) => {
  const session = await requireApiSession(req);
  const { id } = idParam.parse(await ctx.params);
  return NextResponse.json({ instance: await getCtfd().getInstance(session.ctfdToken, id) });
});

export const POST = route("instance-start", async (req, ctx: Ctx) => {
  const session = await requireApiSession(req);
  const { id } = idParam.parse(await ctx.params);
  await enforceRateLimit(`inst:${session.userId}`, 20, 60);
  return NextResponse.json({ instance: await getCtfd().startInstance(session.ctfdToken, id) }, { status: 201 });
});

export const PATCH = route("instance-extend", async (req, ctx: Ctx) => {
  const session = await requireApiSession(req);
  const { id } = idParam.parse(await ctx.params);
  await enforceRateLimit(`inst:${session.userId}`, 20, 60);
  return NextResponse.json({ instance: await getCtfd().extendInstance(session.ctfdToken, id) });
});

export const DELETE = route("instance-stop", async (req, ctx: Ctx) => {
  const session = await requireApiSession(req);
  const { id } = idParam.parse(await ctx.params);
  await enforceRateLimit(`inst:${session.userId}`, 20, 60);
  await getCtfd().stopInstance(session.ctfdToken, id);
  return NextResponse.json({ instance: null });
});
