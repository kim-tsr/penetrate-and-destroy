import { cn } from "@/lib/utils";

export const inputClass =
  "h-10 w-full border border-line-strong bg-bg px-3 text-sm text-fg placeholder:text-muted focus:border-amber focus:outline-none focus:ring-1 focus:ring-amber disabled:opacity-50";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="label block">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Tone = "neutral" | "amber" | "ok" | "alert" | "info";
const TONES: Record<Tone, string> = {
  neutral: "border-line-strong text-dim",
  amber: "border-amber/60 text-amber",
  ok: "border-ok/60 text-ok",
  alert: "border-alert/60 text-alert",
  info: "border-info/60 text-info",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] uppercase leading-none tracking-[0.14em]", TONES[tone], className)}
      {...props}
    />
  );
}

export function Notice({ tone = "info", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <div
      role={tone === "alert" ? "alert" : "status"}
      className={cn("border-l-2 bg-bg-raised px-4 py-3 text-sm", TONES[tone], "text-fg", className)}
    >
      {children}
    </div>
  );
}
