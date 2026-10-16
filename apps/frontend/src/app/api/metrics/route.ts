import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Exposition Prometheus. Protégée par `Authorization: Bearer <METRICS_TOKEN>` (ServiceMonitor).
 * Sans METRICS_TOKEN : fermée (503) en production, ouverte en développement et en test.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "METRICS_TOKEN non configuré" }, { status: 503 });
    }
  } else {
    const auth = req.headers.get("authorization") ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!given || !tokenMatches(given, expected)) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }
  }
  const { registry } = getMetrics();
  return new Response(await registry.metrics(), {
    headers: { "Content-Type": registry.contentType, "Cache-Control": "no-store" },
  });
}
