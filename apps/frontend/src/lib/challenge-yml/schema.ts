import { z } from "zod";

/**
 * Schéma zod du `challenge.yml` : format ctfcli (spec 0.1) étendu par PenetrateAndDestroy
 * avec un bloc `instance` décrivant le scénario chall-manager. Partagé client/serveur.
 */

const DURATION_RE = /^(\d+)\s*(s|m|h)$/;

/** TTL en secondes, en entier ou en durée `30m`, `2h`, `90s`. */
export const ttlSchema = z
  .union([z.number().int(), z.string().regex(DURATION_RE, "durée attendue : 90s, 30m ou 2h")])
  .transform((v) => {
    if (typeof v === "number") return v;
    const [, n, unit] = DURATION_RE.exec(v) ?? [];
    return Number(n) * (unit === "h" ? 3600 : unit === "m" ? 60 : 1);
  })
  .pipe(z.number().int().min(60, "TTL minimal : 60 secondes").max(6 * 3600, "TTL maximal : 6 heures"));

const portSchema = z.union([
  z.number().int().min(1).max(65535),
  z.strictObject({
    port: z.number().int().min(1).max(65535),
    protocol: z.enum(["tcp", "udp"]).default("tcp"),
    name: z.string().max(32).optional(),
  }),
]);

const cpuRe = /^(\d+m|\d+(\.\d+)?)$/;
const memRe = /^\d+(Ki|Mi|Gi)$/;

export const instanceSchema = z.strictObject({
  image: z
    .string()
    .min(1)
    .regex(/^[a-z0-9.-]+(:\d+)?\/[a-z0-9._/-]+(:[\w.-]+)?(@sha256:[a-f0-9]{64})?$/, "référence d'image OCI complète attendue (registry/repo:tag)"),
  ports: z.array(portSchema).min(1, "au moins un port exposé"),
  ttl: ttlSchema.default(3600),
  limits: z
    .strictObject({
      cpu: z.string().regex(cpuRe, "cpu : 500m ou 1").default("500m"),
      memory: z.string().regex(memRe, "mémoire : 256Mi ou 1Gi").default("256Mi"),
    })
    .default({ cpu: "500m", memory: "256Mi" }),
});

const flagSchema = z.union([
  z.string().min(1),
  z.strictObject({
    type: z.enum(["static", "regex"]).default("static"),
    content: z.string().min(1),
    data: z.enum(["case_sensitive", "case_insensitive"]).optional(),
  }),
]);

const hintSchema = z.union([
  z.string().min(1),
  z.strictObject({ content: z.string().min(1), cost: z.number().int().min(0).default(0) }),
]);

const dynamicExtra = z
  .strictObject({
    initial: z.number().int().positive(),
    decay: z.number().int().positive(),
    minimum: z.number().int().min(0),
    function: z.enum(["linear", "logarithmic"]).optional(),
  })
  .refine((e) => e.minimum <= e.initial, { message: "minimum doit être ≤ initial", path: ["minimum"] });

const relativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."), "chemin relatif au ZIP, sans « .. »");

export const challengeYmlSchema = z
  .looseObject({
    name: z.string().trim().min(1, "nom requis").max(80),
    author: z.string().optional(),
    category: z.string().trim().min(1, "catégorie requise").max(40),
    description: z.string().min(1, "description requise"),
    type: z.enum(["standard", "dynamic"]).default("standard"),
    value: z.number().int().min(0).optional(),
    extra: dynamicExtra.optional(),
    connection_info: z.string().optional(),
    attempts: z.number().int().min(0).optional(),
    flags: z.array(flagSchema).min(1, "au moins un flag"),
    files: z.array(relativePath).default([]),
    hints: z.array(hintSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
    topics: z.array(z.string()).optional(),
    requirements: z.array(z.union([z.string(), z.number()])).optional(),
    state: z.enum(["visible", "hidden"]).default("hidden"),
    version: z.string().optional(),
    instance: instanceSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.type === "dynamic") {
      if (!c.extra) {
        ctx.addIssue({ code: "custom", path: ["extra"], message: "scoring dynamique : extra.initial, extra.decay et extra.minimum requis" });
      }
    } else if (c.value === undefined) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "value requis (ou type: dynamic avec extra)" });
    }
  });

export type ChallengeYml = z.output<typeof challengeYmlSchema>;

export interface YmlIssue {
  path: string;
  message: string;
}

export function formatIssues(error: z.ZodError): YmlIssue[] {
  return error.issues.map((i) => ({
    path: i.path.length ? i.path.map(String).join(".") : "(racine)",
    message: i.message,
  }));
}

/** Valeur affichée en preview : fixe ou « 500 → 100 (décroissance 10) ». */
export function describeScoring(c: ChallengeYml): string {
  if (c.type === "dynamic" && c.extra) {
    return `${c.extra.initial} → ${c.extra.minimum} pts, décroissance ${c.extra.decay}${c.extra.function ? ` (${c.extra.function})` : ""}`;
  }
  return `${c.value ?? 0} pts`;
}
