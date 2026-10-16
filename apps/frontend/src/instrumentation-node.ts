/** Démarrage du serveur Node (chargé dynamiquement par instrumentation.ts, hors runtime Edge). */
export async function registerNode() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const mock = process.env.PAD_MOCK === "1" || process.env.PAD_MOCK === "true";
  if (mock && process.env.NODE_ENV === "production") {
    // console direct : le logger n'est pas encore garanti, et ce message doit toujours sortir.
    console.error(JSON.stringify({ level: "fatal", service: "pad-frontend", msg: "PAD_MOCK=1 est interdit avec NODE_ENV=production : démarrage refusé" }));
    // Next garde le processus en vie après un échec d'instrumentation : on sort pour que Kubernetes redémarre/alerte.
    process.exit(1);
  }

  const { parseEnv } = await import("./lib/env");
  const { logger } = await import("./lib/logger");
  try {
    parseEnv(process.env);
  } catch (err) {
    logger.fatal({ err: (err as Error).message }, "configuration invalide, démarrage refusé");
    if (process.env.NODE_ENV === "production") process.exit(1);
    throw err;
  }
  if (mock) logger.warn("PAD_MOCK=1 : CTFd simulé et connexion de test actifs (développement et e2e uniquement)");

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const [{ NodeSDK }, { OTLPTraceExporter }, { resourceFromAttributes }, { ATTR_SERVICE_NAME }] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-grpc"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
    ]);
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "pad-frontend" }),
      traceExporter: new OTLPTraceExporter(),
    });
    sdk.start();
    process.once("SIGTERM", () => void sdk.shutdown());
  }
}
