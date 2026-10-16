import { z } from "zod";

/**
 * Variables d'environnement du BFF, validées paresseusement (jamais au build) pour que
 * `next build` fonctionne sans secret. Toute lecture passe par `getEnv()`.
 */
const boolish = z
  .enum(["0", "1", "true", "false", ""])
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PAD_MOCK: boolish,
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET doit faire au moins 32 caractères"),
    AUTH_URL: z.url().optional(),
    AUTH_AUTHENTIK_ISSUER: z.url().optional(),
    AUTH_AUTHENTIK_ID: z.string().default("pad-frontend"), // contracts: identity.oidc_clients.frontend
    AUTH_AUTHENTIK_SECRET: z.string().optional(),
    CTFD_URL: z.url().default("http://ctfd.ctfd.svc.cluster.local:8000"),
    PAD_SSO_SHARED_SECRET: z.string().min(32, "PAD_SSO_SHARED_SECRET doit faire au moins 32 caractères"),
    VALKEY_URL: z.string().optional(),
    METRICS_TOKEN: z.string().optional(),
    NETBIRD_API_URL: z.url().optional(),
    NETBIRD_API_TOKEN: z.string().optional(),
    NETBIRD_MANAGEMENT_URL: z.url().optional(),
    PAD_GIT_REPO_URL: z.url().optional(),
    PAD_GIT_SYNC_STATUS_URL: z.url().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    PAD_EVENT_NAME: z.string().default("PenetrateAndDestroy"),
    PAD_EVENT_START: z.iso.datetime({ offset: true }).optional(),
    PAD_EVENT_END: z.iso.datetime({ offset: true }).optional(),
    PAD_API_RATE_LIMIT: z.coerce.number().int().positive().default(1200),
    PAD_FLAG_RATE_LIMIT: z.coerce.number().int().positive().default(10),
    PAD_FLAG_RATE_WINDOW_S: z.coerce.number().int().positive().default(60),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.PAD_MOCK) {
      ctx.addIssue({ code: "custom", path: ["PAD_MOCK"], message: "PAD_MOCK=1 est interdit avec NODE_ENV=production" });
    }
    if (env.NODE_ENV === "production" && !env.PAD_MOCK) {
      if (!env.AUTH_URL) ctx.addIssue({ code: "custom", path: ["AUTH_URL"], message: "AUTH_URL est requis en production" });
      if (!env.METRICS_TOKEN) {
        ctx.addIssue({ code: "custom", path: ["METRICS_TOKEN"], message: "METRICS_TOKEN est requis en production (/api/metrics)" });
      }
    }
    if (!env.PAD_MOCK && (!env.AUTH_AUTHENTIK_ISSUER || !env.AUTH_AUTHENTIK_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_AUTHENTIK_ISSUER"],
        message: "AUTH_AUTHENTIK_ISSUER et AUTH_AUTHENTIK_SECRET sont requis hors mode mock",
      });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide : ${details}`);
  }
  return result.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Vrai si les mocks MSW sont actifs (dev / e2e uniquement). Ne lève jamais. */
export function isMockMode(): boolean {
  const v = process.env.PAD_MOCK;
  return (v === "1" || v === "true") && process.env.NODE_ENV !== "production";
}

/** Cookies sécurisés dès que l'URL publique est en HTTPS. */
export function secureCookiesEnabled(): boolean {
  return (process.env.AUTH_URL ?? "").startsWith("https://");
}
