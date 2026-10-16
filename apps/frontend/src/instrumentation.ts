/**
 * Exécuté une fois au démarrage du serveur (pas pendant `next build`).
 *  - valide l'environnement et REFUSE de démarrer en production avec PAD_MOCK=1 ;
 *  - démarre l'export OpenTelemetry (traces OTLP gRPC) si OTEL_EXPORTER_OTLP_ENDPOINT est défini.
 * Le travail réel est dans instrumentation-node.ts, chargé uniquement dans le runtime Node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}

export async function onRequestError(err: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./lib/logger");
  logger.error({ err: (err as Error)?.message, digest: (err as { digest?: string })?.digest, path: request.path, method: request.method }, "erreur de rendu");
}
