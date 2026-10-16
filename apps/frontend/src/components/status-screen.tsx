import { ButtonLink } from "@/components/ui/button";

/** Écran d'état plein cadre (403, 404, 500...) dans l'esthétique console. */
export function StatusScreen({
  code,
  title,
  children,
  action,
}: {
  code: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl flex-col justify-center px-4 py-16">
      <p className="tabular font-display text-[9rem] font-black leading-none text-amber/90">{code}</p>
      <h1 className="-mt-2 text-4xl">{title}</h1>
      {children ? <div className="mt-3 text-sm text-dim">{children}</div> : null}
      <div className="mt-6 flex gap-3">
        {action}
        <ButtonLink href="/" variant="ghost">
          Accueil
        </ButtonLink>
      </div>
    </div>
  );
}
