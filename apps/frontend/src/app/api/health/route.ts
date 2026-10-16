import { NextResponse } from "next/server";
import { getKv } from "@/lib/kv";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Sonde liveness/readiness. Ne dépend de rien d'externe pour répondre 200 : une panne Valkey
 * dégrade seulement le rate limiting et le compteur de sessions (le front reste utilisable).
 */
export async function GET() {
  const kv = getKv();
  const valkey = kv.kind === "memory" ? "memory" : (await kv.ping()) ? "ok" : "down";
  return NextResponse.json(
    {
      status: valkey === "down" ? "degraded" : "ok",
      service: "pad-frontend",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: { valkey },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
