"use client";
import { CheckCircle2, CircleDashed, Droplet, Server } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/panel";
import type { ChallengeSummary } from "@/lib/ctfd/types";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "todo" | "solved";

const DIFF_TONE = { easy: "ok", medium: "amber", hard: "alert", insane: "alert" } as const;
const DIFF_LABEL = { easy: "facile", medium: "moyen", hard: "difficile", insane: "insane" } as const;

export function ChallengeBoard({ challenges }: { challenges: ChallengeSummary[] }) {
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const categories = useMemo(() => [...new Set(challenges.map((c) => c.category))].sort(), [challenges]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return challenges.filter(
      (c) =>
        (category === "all" || c.category === category) &&
        (status === "all" || (status === "solved" ? c.solvedByMe : !c.solvedByMe)) &&
        (!q || c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q))),
    );
  }, [challenges, category, status, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChallengeSummary[]>();
    for (const c of visible) map.set(c.category, [...(map.get(c.category) ?? []), c]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const solved = challenges.filter((c) => c.solvedByMe).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Catégorie" className="flex flex-wrap gap-1">
          {["all", ...categories].map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                "h-8 border px-3 text-[11px] uppercase tracking-[0.14em] transition-colors",
                category === c ? "border-amber bg-amber text-amber-ink" : "border-line-strong text-dim hover:border-amber hover:text-amber",
              )}
            >
              {c === "all" ? "Tout" : c}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Statut" className="ml-auto flex gap-1">
          {(
            [
              ["all", "Tous"],
              ["todo", "À faire"],
              ["solved", "Résolus"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={status === v}
              onClick={() => setStatus(v)}
              className={cn(
                "h-8 border px-3 text-[11px] uppercase tracking-[0.14em] transition-colors",
                status === v ? "border-fg bg-fg text-bg" : "border-line-strong text-dim hover:border-fg hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="chal-search">
          Rechercher un challenge
        </label>
        <input
          id="chal-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="rechercher…"
          className="h-8 w-44 border border-line-strong bg-bg px-3 text-xs text-fg placeholder:text-muted focus:border-amber focus:outline-none"
        />
      </div>

      <p className="label" data-testid="progress">
        {solved} / {challenges.length} résolus
      </p>

      {grouped.length === 0 ? (
        <EmptyState title="Aucun challenge">Aucun challenge ne correspond à ces filtres.</EmptyState>
      ) : (
        grouped.map(([cat, list]) => (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`} className="mb-3 flex items-baseline gap-3 text-2xl">
              {cat}
              <span className="tabular font-mono text-xs font-normal tracking-normal text-muted">
                {list.filter((c) => c.solvedByMe).length}/{list.length}
              </span>
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <li key={c.id}>
                  <ChallengeCard c={c} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ChallengeCard({ c }: { c: ChallengeSummary }) {
  return (
    <Link
      href={`/challenges/${c.id}`}
      className={cn(
        "panel group relative block h-full p-4 no-underline transition-all hover:-translate-y-0.5 hover:border-amber/60 hover:no-underline hover:shadow-glow",
        c.solvedByMe && "border-ok/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {c.difficulty ? <Badge tone={DIFF_TONE[c.difficulty]}>{DIFF_LABEL[c.difficulty]}</Badge> : null}
          {c.instanced ? (
            <Badge tone="info">
              <Server className="size-3" /> instance
            </Badge>
          ) : null}
          {c.firstBlood === "mine" ? (
            <Badge tone="alert">
              <Droplet className="size-3" /> first blood
            </Badge>
          ) : null}
        </div>
        {c.solvedByMe ? (
          <CheckCircle2 aria-label="Résolu" className="size-5 shrink-0 text-ok" />
        ) : c.attempted ? (
          <CircleDashed aria-label="Tenté" className="size-5 shrink-0 text-amber" />
        ) : null}
      </div>
      <h3 className="mt-4 text-2xl leading-tight text-fg group-hover:text-amber">{c.name}</h3>
      <div className="mt-4 flex items-end justify-between">
        <p className="tabular font-display text-4xl leading-none text-amber">
          {c.value}
          <span className="ml-1 font-mono text-xs text-muted">pts</span>
        </p>
        <p className="text-xs text-muted">
          {c.solves} résolution{c.solves > 1 ? "s" : ""}
        </p>
      </div>
      {c.firstBloodBy ? (
        <p data-testid="first-blood" className="mt-2 flex items-center gap-1 text-xs text-muted">
          <Droplet className="size-3 text-alert" aria-hidden />
          <span className="label">First blood</span>
          <span className={cn("truncate", c.firstBlood === "mine" ? "text-alert" : "text-dim")}>{c.firstBloodBy.accountName}</span>
        </p>
      ) : null}
      {c.solvedByMe ? (
        <span
          aria-hidden
          className="absolute right-3 top-9 -rotate-6 border-2 border-ok/70 px-2 py-0.5 font-display text-lg uppercase tracking-widest text-ok/80"
        >
          Résolu
        </span>
      ) : null}
    </Link>
  );
}
