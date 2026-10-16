import { z } from "zod";

/** Validation zod de toutes les entrées du BFF (corps JSON, paramètres de route, query string). */

export const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });
export const fileParams = z.object({
  challengeId: z.coerce.number().int().positive().max(2_147_483_647),
  index: z.coerce.number().int().min(0).max(99),
});
export const hintParams = z.object({
  id: z.coerce.number().int().positive().max(2_147_483_647),
  hintId: z.coerce.number().int().positive().max(2_147_483_647),
});

/** Flag soumis : jamais journalisé (cf. redact du logger). */
export const attemptBody = z.object({ submission: z.string().trim().min(1, "Le flag est vide").max(512, "Flag trop long") });

export const teamCredentials = z.object({
  name: z.string().trim().min(2, "2 caractères minimum").max(128, "128 caractères maximum"),
  password: z.string().min(6, "6 caractères minimum").max(128, "128 caractères maximum"),
});

export const moderationBody = z
  .object({ banned: z.boolean().optional(), hidden: z.boolean().optional() })
  .refine((v) => v.banned !== undefined || v.hidden !== undefined, "banned ou hidden requis");

const nullableDate = z.iso.datetime({ offset: true }).nullable();
export const eventBody = z
  .object({
    start: nullableDate.optional(),
    end: nullableDate.optional(),
    freeze: nullableDate.optional(),
    paused: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Aucune modification");

export const notificationsQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });
export const statsQuery = z.object({ bucket: z.enum(["hour", "day"]).default("hour") });
export const topQuery = z.object({ top: z.coerce.number().int().min(1).max(20).default(10) });

export const zipUpload = z.object({
  name: z.string().toLowerCase().endsWith(".zip", "Un fichier .zip est attendu").max(255),
  size: z.number().int().positive("Archive vide").max(50 * 1024 * 1024, "Archive trop volumineuse (50 Mo max)"),
});
