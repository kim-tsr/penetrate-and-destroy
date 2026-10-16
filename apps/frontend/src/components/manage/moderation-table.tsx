"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/form";
import { api } from "@/lib/client-api";
import type { AdminAward, AdminSubmission, AdminTeam, AdminUser } from "@/lib/ctfd/types";

type Row = { id: number; name: string; detail: string; banned: boolean; hidden: boolean };

function Table({ kind, title, initial }: { kind: "users" | "teams"; title: string; initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);

  async function toggle(row: Row, field: "banned" | "hidden") {
    setBusy(row.id);
    try {
      await api(`/api/manage/moderation/${kind}/${row.id}`, { method: "PATCH", json: { [field]: !row[field] } });
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [field]: !r[field] } : r)));
      toast.success(`${row.name} : ${field === "banned" ? (row.banned ? "débanni" : "banni") : row.hidden ? "visible" : "masqué"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Modération impossible");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="label border-b border-line text-left">
            <th scope="col" className="px-4 py-2 font-normal">
              Nom
            </th>
            <th scope="col" className="hidden px-2 py-2 font-normal sm:table-cell">
              Détail
            </th>
            <th scope="col" className="px-2 py-2 font-normal">
              État
            </th>
            <th scope="col" className="px-4 py-2 text-right font-normal">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-2">{r.name}</td>
              <td className="hidden px-2 py-2 text-muted sm:table-cell">{r.detail}</td>
              <td className="space-x-1 px-2 py-2">
                {r.banned ? <Badge tone="alert">banni</Badge> : null}
                {r.hidden ? <Badge tone="amber">masqué</Badge> : null}
                {!r.banned && !r.hidden ? <Badge tone="ok">actif</Badge> : null}
              </td>
              <td className="space-x-2 px-4 py-2 text-right">
                <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void toggle(r, "hidden")}>
                  {r.hidden ? "Afficher" : "Masquer"}
                </Button>
                <Button size="sm" variant={r.banned ? "ghost" : "danger"} disabled={busy === r.id} onClick={() => void toggle(r, "banned")}>
                  {r.banned ? "Débannir" : "Bannir"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsersModeration({ users }: { users: AdminUser[] }) {
  return (
    <Table
      kind="users"
      title="Joueurs"
      initial={users.map((u) => ({
        id: u.id,
        name: u.name,
        detail: [u.email, u.teamName, u.roles.join(", ")].filter(Boolean).join(" · "),
        banned: u.banned,
        hidden: u.hidden,
      }))}
    />
  );
}

type InvalidateRow = { id: number; label: string; detail: string; date: string };

function InvalidateTable({ kind, title, noun, initial }: { kind: "submissions" | "awards"; title: string; noun: string; initial: InvalidateRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);

  async function invalidate(row: InvalidateRow) {
    if (!window.confirm(`Invalider ${noun} « ${row.label} » (${row.detail}) ? Les scores sont recalculés.`)) return;
    setBusy(row.id);
    try {
      await api(`/api/manage/moderation/${kind}/${row.id}`, { method: "DELETE" });
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      toast.success(`${noun} invalidé : ${row.label}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalidation impossible");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-muted">Rien à afficher.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-2">{r.label}</td>
              <td className="hidden px-2 py-2 text-muted sm:table-cell">{r.detail}</td>
              <td className="hidden px-2 py-2 text-xs text-muted md:table-cell">{new Date(r.date).toUTCString()}</td>
              <td className="px-4 py-2 text-right">
                <Button size="sm" variant="danger" disabled={busy === r.id} onClick={() => void invalidate(r)}>
                  Invalider
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SubmissionsModeration({ submissions }: { submissions: AdminSubmission[] }) {
  return (
    <InvalidateTable
      kind="submissions"
      title="Résolutions récentes"
      noun="le solve"
      initial={submissions.map((s) => ({
        id: s.id,
        label: s.challengeName ?? `#${s.challengeId}`,
        detail: [s.teamName, s.userName].filter(Boolean).join(" / "),
        date: s.date,
      }))}
    />
  );
}

export function AwardsModeration({ awards }: { awards: AdminAward[] }) {
  return (
    <InvalidateTable
      kind="awards"
      title="Awards"
      noun="l'award"
      initial={awards.map((a) => ({
        id: a.id,
        label: `${a.name} (${a.value} pts)`,
        detail: [a.teamName, a.userName].filter(Boolean).join(" / "),
        date: a.date,
      }))}
    />
  );
}

export function TeamsModeration({ teams }: { teams: AdminTeam[] }) {
  return (
    <Table
      kind="teams"
      title="Équipes"
      initial={teams.map((t) => ({ id: t.id, name: t.name, detail: `${t.memberCount} membre(s)`, banned: t.banned, hidden: t.hidden }))}
    />
  );
}
