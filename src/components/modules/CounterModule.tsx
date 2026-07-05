import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Minus, Plus, RotateCcw } from "lucide-react"

export default function CounterModule() {
  const [value, setValue] = useState(0)
  const [step, setStep] = useState(1)
  const [label, setLabel] = useState("COUNT")

  return (
    <div className="flex flex-col items-center gap-4 p-2 h-full justify-between">
      <div className="w-full">
        <Input
          value={label}
          onChange={e => setLabel(e.target.value.toUpperCase())}
          className="text-center font-mono text-xs h-7 bg-muted/40 border-border/60 uppercase"
        />
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="font-mono text-5xl font-bold tabular-nums text-primary leading-none">
          {value.toLocaleString()}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">STEP: {step}</span>
      </div>

      <div className="flex items-center gap-2 w-full">
        <Button
          variant="outline"
          size="icon"
          className="flex-1 h-9"
          onClick={() => setValue(v => v - step)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => setValue(0)}
          title="Reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="default"
          size="icon"
          className="flex-1 h-9"
          onClick={() => setValue(v => v + step)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2 w-full">
        <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">STEP</span>
        <Input
          type="number"
          value={step}
          onChange={e => setStep(Number(e.target.value) || 1)}
          className="h-7 text-xs font-mono text-center bg-muted/40 border-border/60"
          min={1}
        />
      </div>
    </div>
  )
}
