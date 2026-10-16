import * as client from "prom-client";
import { getKv } from "./kv";

/**
 * Registre Prometheus unique par processus (stocké sur globalThis : Next charge les
 * route handlers et le proxy dans des bundles distincts).
 */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
export const ACTIVE_SET = "active-users";

function build() {
  const registry = new client.Registry();
  registry.setDefaultLabels({ app: "pad-frontend" });
  client.collectDefaultMetrics({ register: registry, prefix: "pad_frontend_" });

  const httpRequests = new client.Counter({
    name: "pad_frontend_http_requests_total",
    help: "Requêtes HTTP traitées par le front (pages et BFF)",
    labelNames: ["kind", "route", "method", "status"] as const,
    registers: [registry],
  });
  const httpDuration = new client.Histogram({
    name: "pad_frontend_http_request_duration_seconds",
    help: "Latence des route handlers du BFF",
    labelNames: ["route", "method", "status"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  const upstreamDuration = new client.Histogram({
    name: "pad_frontend_ctfd_request_duration_seconds",
    help: "Latence des appels du BFF vers l'API CTFd",
    labelNames: ["endpoint", "method", "status"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  const flagSubmissions = new client.Counter({
    name: "pad_frontend_flag_submissions_total",
    help: "Soumissions de flags par résultat",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const sseClients = new client.Gauge({
    name: "pad_frontend_sse_clients",
    help: "Connexions SSE ouvertes sur ce pod",
    labelNames: ["stream"] as const,
    registers: [registry],
  });
  // Valeur globale (ensemble trié partagé dans Valkey) : identique sur chaque pod.
  // KEDA doit donc l'agréger avec max() et non sum().
  new client.Gauge({
    name: "pad_frontend_active_sessions",
    help: "Utilisateurs authentifiés actifs sur les 5 dernières minutes (tous pods confondus)",
    registers: [registry],
    async collect() {
      try {
        this.set(await getKv().countSince(ACTIVE_SET, Date.now() - ACTIVE_WINDOW_MS));
      } catch {
        // Store indisponible : on garde la dernière valeur connue.
      }
    },
  });

  return { registry, httpRequests, httpDuration, upstreamDuration, flagSubmissions, sseClients };
}

type Metrics = ReturnType<typeof build>;
const g = globalThis as unknown as { __padMetrics?: Metrics };

export function getMetrics(): Metrics {
  g.__padMetrics ??= build();
  return g.__padMetrics;
}

/** Enregistre l'activité d'un utilisateur authentifié (alimente pad_frontend_active_sessions). */
export async function markActive(userId: string | number): Promise<void> {
  try {
    await getKv().touch(ACTIVE_SET, String(userId), Date.now());
  } catch {
    // non bloquant
  }
}
