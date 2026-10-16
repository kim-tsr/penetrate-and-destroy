import { cn } from "@/lib/utils";

/** Panneau à repères d'angle. `title` s'affiche dans une barre d'état façon console. */
export function Panel({
  title,
  aside,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel", className)} {...props}>
      {title || aside ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="label flex items-center gap-2 !font-mono !text-[11px] !font-medium !leading-none text-dim">
            <span aria-hidden className="inline-block h-2 w-2 bg-amber" />
            {title}
          </h2>
          {aside ? <div className="text-xs text-muted">{aside}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker?: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div>
        {kicker ? <p className="label mb-1 text-amber">{kicker}</p> : null}
        <h1 className="text-4xl text-fg sm:text-5xl">{title}</h1>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="panel p-4">
      <p className="label">{label}</p>
      <p className={cn("tabular mt-1 font-display text-5xl leading-none", accent ? "text-amber" : "text-fg")}>{value}</p>
      {hint ? <p className="mt-2 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="hatch border border-dashed border-line-strong p-8 text-center">
      <p className="font-display text-2xl uppercase tracking-wide text-dim">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-prose text-sm text-muted">{children}</div> : null}
    </div>
  );
}
