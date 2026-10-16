export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-12 w-1/3 animate-pulse-amber bg-panel" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-28 animate-pulse-amber bg-panel" />
        <div className="h-28 animate-pulse-amber bg-panel" />
        <div className="h-28 animate-pulse-amber bg-panel" />
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
