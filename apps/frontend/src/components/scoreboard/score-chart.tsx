"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ScoreSeries } from "@/lib/ctfd/types";

const COLORS = ["#ffb000", "#efe7d3", "#8fd694", "#7fb7c9", "#ff6a4d", "#d9a066", "#9aa5b1", "#e6d98a", "#a3c585", "#c48b9f"];

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

/** Courbes de score cumulé (paliers) des meilleures équipes. `until` prolonge chaque courbe jusqu'à l'instant de l'instantané. */
export function ScoreChart({ series, until }: { series: ScoreSeries[]; until: number }) {
  const lines = series
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const last = s.points[s.points.length - 1]!;
      return { ...s, points: until > last.t ? [...s.points, { t: until, score: last.score }] : s.points };
    });
  if (lines.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">Aucun point marqué pour l&apos;instant.</p>;
  }
  return (
    <div className="h-72 w-full" role="img" aria-label="Évolution du score des meilleures équipes">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#2a2f35" strokeDasharray="2 4" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={hhmm}
            stroke="#7f7b70"
            tick={{ fontSize: 11, fill: "#7f7b70" }}
            allowDuplicatedCategory={false}
          />
          <YAxis stroke="#7f7b70" tick={{ fontSize: 11, fill: "#7f7b70" }} width={44} />
          <Tooltip
            contentStyle={{ background: "#181b1f", border: "1px solid #3d444c", borderRadius: 0, fontSize: 12 }}
            labelStyle={{ color: "#b6ae9b" }}
            labelFormatter={(t) => `${hhmm(Number(t))} UTC`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {lines.map((s, i) => (
            <Line
              key={s.accountId}
              data={s.points}
              dataKey="score"
              name={s.name}
              type="stepAfter"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={i === 0 ? 2.5 : 1.75}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
