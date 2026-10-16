import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formate une durée en secondes en `HH:MM:SS` (ou `Jj HH:MM:SS`). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hms = [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
  return days > 0 ? `${days}j ${hms}` : hms;
}

export function formatRelative(date: string | Date, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.round((now.getTime() - d.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  if (Math.abs(diff) < 60) return rtf.format(-diff, "second");
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export function ordinalFr(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

/** Redirection post-connexion : chemin relatif uniquement (pas de redirection ouverte). */
export function safeCallbackPath(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/login")) return "/dashboard";
  return raw;
}
