import type { NextRequest } from "next/server";
import { clientIp, enforceRateLimit, toErrorResponse } from "@/lib/bff";
import { CtfdError } from "@/lib/ctfd/http";
import { getMetrics } from "@/lib/metrics";
import { getScoreboardSnapshot } from "@/lib/scoreboard-feed";
import { topQuery } from "@/lib/schemas";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const POLL_MS = 5_000;
const HEARTBEAT_MS = 15_000;
/** Durée maximale d'une connexion : le client (EventSource) se reconnecte, ce qui renouvelle session et token. */
const MAX_LIFETIME_MS = 10 * 60_000;

/**
 * Flux SSE du scoreboard. Un événement `scoreboard` est émis à l'ouverture puis à chaque changement ;
 * `unavailable` (403) indique un scoreboard non public pour un visiteur anonyme.
 */
export async function GET(req: NextRequest) {
  const name = "scoreboard-stream";
  try {
    await enforceRateLimit(`sse:${clientIp(req)}`, 30, 60);
    const { top } = topQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    const encoder = new TextEncoder();
    const { sseClients, httpRequests } = getMetrics();
    httpRequests.inc({ kind: "api", route: name, method: "GET", status: "200" });
    let cleanup = () => {};

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        sseClients.inc({ stream: "scoreboard" });
        let closed = false;
        let lastHash = "";
        const send = (chunk: string) => {
          if (!closed) controller.enqueue(encoder.encode(chunk));
        };
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(poll);
          clearInterval(beat);
          clearTimeout(ttl);
          sseClients.dec({ stream: "scoreboard" });
          try {
            controller.close();
          } catch {
            // déjà fermé
          }
        };
        cleanup = close;

        const tick = async () => {
          try {
            // Le jeton CTFd peut avoir expiré depuis l'ouverture du flux : on le résout à chaque tour.
            const session = await getServerSession(req.headers).catch(() => null);
            const snap = await getScoreboardSnapshot(session?.ctfdToken ?? null, top);
            if (snap.hash !== lastHash) {
              lastHash = snap.hash;
              send(`event: scoreboard\ndata: ${JSON.stringify({ entries: snap.entries, series: snap.series, at: snap.at })}\n\n`);
            }
          } catch (err) {
            if (err instanceof CtfdError && (err.status === 401 || err.status === 403)) {
              send(`event: unavailable\ndata: ${JSON.stringify({ status: err.status })}\n\n`);
              close();
              return;
            }
            send(`event: warning\ndata: ${JSON.stringify({ message: "CTFd indisponible" })}\n\n`);
          }
        };

        const poll = setInterval(() => void tick(), POLL_MS);
        const beat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
        const ttl = setTimeout(close, MAX_LIFETIME_MS);
        req.signal.addEventListener("abort", close);
        send("retry: 3000\n\n");
        await tick();
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return toErrorResponse(err, name);
  }
}
