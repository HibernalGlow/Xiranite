import { Minus, Minimize2, Square, X } from "lucide-react"

export function WindowControlIcon({ action, maximized = false }: {
  action: "minimize" | "maximize" | "close"
  maximized?: boolean
}) {
  if (action === "minimize") return <Minus className="size-3.5" />
  if (action === "close") return <X className="size-3.5" />
  return maximized ? <Minimize2 className="size-3.5" /> : <Square className="size-3" />
}
