"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function SolvesChart({ data, bucket }: { data: { t: string; solves: number; cumulative: number }[]; bucket: "hour" | "day" }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">Aucune résolution.</p>;
  }
  const fmt = (t: string) => (bucket === "day" ? t.slice(5, 10) : t.slice(11, 16));
  return (
    <div className="h-64 w-full" role="img" aria-label="Résolutions cumulées dans le temps">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#2a2f35" strokeDasharray="2 4" />
          <XAxis dataKey="t" tickFormatter={fmt} stroke="#7f7b70" tick={{ fontSize: 11, fill: "#7f7b70" }} />
          <YAxis allowDecimals={false} stroke="#7f7b70" tick={{ fontSize: 11, fill: "#7f7b70" }} width={32} />
          <Tooltip contentStyle={{ background: "#181b1f", border: "1px solid #3d444c", borderRadius: 0, fontSize: 12 }} />
          <Area type="stepAfter" dataKey="cumulative" name="Cumul" stroke="#ffb000" fill="#ffb000" fillOpacity={0.15} isAnimationActive={false} />
          <Area type="stepAfter" dataKey="solves" name="Sur la tranche" stroke="#efe7d3" fill="transparent" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
