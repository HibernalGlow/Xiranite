import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { FlaskConical, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Stream { id: string; label: string; value: number; color: string }

let sid = 0

const COLORS = ["text-chart-1", "text-chart-2", "text-chart-3", "text-chart-4", "text-chart-5"]
const STREAM_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]

export default function AcidMixerModule() {
  const { t } = useTranslation()
  const [streams, setStreams] = useState<Stream[]>([
    { id: `s-${++sid}`, label: "STREAM_A", value: 42, color: COLORS[0] },
    { id: `s-${++sid}`, label: "STREAM_B", value: 17, color: COLORS[1] },
  ])
  const [operation, setOperation] = useState<"+" | "*" | "max" | "mix">("+")
  const [output, setOutput] = useState<number | null>(null)

  function addStream() {
    if (streams.length >= 5) return
    const idx = streams.length
    setStreams(ss => [...ss, { id: `s-${++sid}`, label: `STREAM_${String.fromCharCode(65 + idx)}`, value: Math.floor(Math.random() * 100), color: COLORS[idx] }])
  }

  function removeStream(id: string) {
    setStreams(ss => ss.filter(s => s.id !== id))
    setOutput(null)
  }

  function updateValue(id: string, val: number) {
    setStreams(ss => ss.map(s => s.id === id ? { ...s, value: val } : s))
    setOutput(null)
  }

  function compute() {
    const vals = streams.map(s => s.value)
    let result = 0
    if (operation === "+") result = vals.reduce((a, b) => a + b, 0)
    else if (operation === "*") result = vals.reduce((a, b) => a * b, 1)
    else if (operation === "max") result = Math.max(...vals)
    else result = vals.reduce((a, b) => a + b, 0) / vals.length
    setOutput(result)
  }

  return (
    <div className="flex flex-col gap-2 h-full p-1">
      <div className="space-y-1 flex-1 overflow-y-auto">
        {streams.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 group">
            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", STREAM_COLORS[i])} />
            <span className="text-[10px] font-mono text-muted-foreground w-16 truncate">{s.label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={s.value}
              onChange={e => updateValue(s.id, Number(e.target.value))}
              className="flex-1 accent-primary h-1"
            />
            <span className="font-mono text-xs text-foreground w-8 text-right tabular-nums">{s.value}</span>
            <button
              onClick={() => removeStream(s.id)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <Separator className="opacity-50" />

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground">{t("module:acidMixer.operation")}</span>
        {(["+", "*", "max", "mix"] as const).map(op => (
          <button
            key={op}
            onClick={() => setOperation(op)}
            className={cn(
              "px-2 py-0.5 text-[10px] font-mono rounded border transition-colors",
              operation === op
                ? "bg-primary/15 border-primary/50 text-primary"
                : "border-border/40 text-muted-foreground hover:text-foreground"
            )}
          >
            {op}
          </button>
        ))}
        <button
          onClick={addStream}
          disabled={streams.length >= 5}
          className="ml-auto text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" className="flex-1 h-8 font-mono text-xs" onClick={compute}>
          <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
          {t("module:acidMixer.synthesize")}
        </Button>
        {output !== null && (
          <Badge variant="outline" className="font-mono text-primary border-primary/40 h-8 px-3">
            {parseFloat(output.toPrecision(6))}
          </Badge>
        )}
      </div>
    </div>
  )
}
