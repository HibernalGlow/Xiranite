import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export interface SystemMonitorHistoryPoint {
  sampledAtMs: number
  cpuPercent: number
  memoryPercent: number
}

export default function SystemMonitorHistoryChart({ samples }: { samples: readonly SystemMonitorHistoryPoint[] }) {
  return (
    <div className="h-36 min-w-0" aria-label="CPU 与内存使用率趋势">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={144} initialDimension={{ width: 300, height: 144 }}>
        <LineChart data={samples} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <XAxis dataKey="sampledAtMs" hide />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={46} />
          <Tooltip
            labelFormatter={(value) => new Date(Number(value)).toLocaleTimeString()}
            formatter={(value, name) => [`${finitePercent(Number(value)).toFixed(1)}%`, name === "cpuPercent" ? "CPU" : "内存"]}
          />
          <Line type="monotone" dataKey="cpuPercent" stroke="var(--chart-1)" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="memoryPercent" stroke="var(--chart-2)" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function finitePercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
}
