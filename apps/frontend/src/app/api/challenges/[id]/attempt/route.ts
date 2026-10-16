import { NextResponse } from "next/server";
import { enforceFlagRateLimit, requireApiSession, route } from "@/lib/bff";
import { getCtfd } from "@/lib/ctfd/client";
import { getMetrics } from "@/lib/metrics";
import { attemptBody, idParam } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const POST = route("attempt", async (req, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireApiSession(req);
  const { id } = idParam.parse(await ctx.params);
  const { submission } = attemptBody.parse(await req.json().catch(() => null));
  await enforceFlagRateLimit(session.userId, id);
  const result = await getCtfd().attempt(session.ctfdToken, id, submission);
  getMetrics().flagSubmissions.inc({ result: result.status });
  return NextResponse.json(result, { status: result.status === "ratelimited" ? 429 : 200 });
});
