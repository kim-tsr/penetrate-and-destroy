import pino from "pino";

/** Logs JSON sur stdout (collectés par Alloy -> Loki). Pas de transport : le format reste du JSON brut. */
const globalForLogger = globalThis as unknown as { __padLogger?: pino.Logger };

export const logger: pino.Logger =
  globalForLogger.__padLogger ??
  pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: "pad-frontend" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ["token", "ctfdToken", "*.token", "*.ctfdToken", "headers.authorization", "headers.cookie", "submission"],
      censor: "[redacted]",
    },
  });

globalForLogger.__padLogger = logger;
