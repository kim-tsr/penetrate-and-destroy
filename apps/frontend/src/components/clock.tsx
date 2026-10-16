"use client";
import { useNow } from "@/lib/use-now";
import { cn, formatDuration } from "@/lib/utils";

/** Heure UTC, façon bandeau de salle d'opérations. */
export function UtcClock({ className }: { className?: string }) {
  const now = useNow();
  const text = now ? new Date(now).toISOString().slice(11, 19) : "--:--:--";
  return (
    <time dateTime={now ? new Date(now).toISOString() : undefined} suppressHydrationWarning className={cn("tabular", className)}>
      {text} UTC
    </time>
  );
}

/** Compte à rebours jusqu'à `to` (ISO). Passe en rouge sous `warnBelow` secondes. */
export function Countdown({
  to,
  className,
  warnBelow = 300,
  expiredText = "00:00:00",
}: {
  to: string | null;
  className?: string;
  warnBelow?: number;
  expiredText?: string;
}) {
  const now = useNow();
  if (!to) return <span className={className}>--:--:--</span>;
  const target = Date.parse(to);
  if (!now || !Number.isFinite(target)) return <span className={cn("tabular", className)}>--:--:--</span>;
  const remaining = Math.max(0, Math.floor((target - now) / 1000));
  return (
    <span
      className={cn("tabular", remaining === 0 ? "text-alert" : remaining < warnBelow ? "text-alert animate-pulse-amber" : "", className)}
      aria-label={`Temps restant : ${formatDuration(remaining)}`}
    >
      {remaining === 0 ? expiredText : formatDuration(remaining)}
    </span>
  );
}
