import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface TerminalLine {
  type: "cmd" | "out" | "err" | "sys"
  text: string
  time: string
}

const MOTD = [
  { type: "sys" as const, text: "WULING_CITY_OS v4.0.0 — Terminal Interface Active" },
  { type: "sys" as const, text: "Type 'help' for available commands." },
]

const COMMANDS: Record<string, (args: string[]) => string[]> = {
  help: () => [
    "Available commands:",
    "  help          — show this message",
    "  echo <text>   — print text",
    "  clear         — clear terminal",
    "  date          — show current date/time",
    "  whoami        — show operator identity",
    "  status        — show system status",
    "  ls            — list workspace modules",
  ],
  echo: (args) => [args.join(" ")],
  date: () => [new Date().toString()],
  whoami: () => ["OPERATOR_01 // SYS_VER_4.0_STABLE"],
  status: () => [
    "SYS: ONLINE", "NET: NOMINAL", "DB: SYNCED", "UPTIME: 99.9%",
  ],
  ls: () => [
    "scratch    counter    acid-mixer    terminal",
    "tasks      clock      calculator    kanban",
  ],
}

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false })
}

export default function TerminalModule() {
  const [lines, setLines] = useState<TerminalLine[]>(
    MOTD.map(l => ({ ...l, time: timestamp() }))
  )
  const [input, setInput] = useState("")
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [lines])

  function exec(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return
    const [cmd, ...args] = trimmed.split(/\s+/)

    setLines(ls => [...ls, { type: "cmd", text: `$ ${trimmed}`, time: timestamp() }])
    setHistory(h => [trimmed, ...h.slice(0, 49)])
    setHistIdx(-1)

    if (cmd === "clear") {
      setLines([])
      return
    }

    const handler = COMMANDS[cmd.toLowerCase()]
    if (handler) {
      const out = handler(args)
      setLines(ls => [...ls, ...out.map(t => ({ type: "out" as const, text: t, time: timestamp() }))])
    } else {
      setLines(ls => [...ls, { type: "err", text: `command not found: ${cmd}`, time: timestamp() }])
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      exec(input)
      setInput("")
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const idx = histIdx + 1
      if (idx < history.length) { setHistIdx(idx); setInput(history[idx]) }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const idx = histIdx - 1
      if (idx < 0) { setHistIdx(-1); setInput("") }
      else { setHistIdx(idx); setInput(history[idx]) }
    }
  }

  const lineColor = (type: TerminalLine["type"]) => {
    if (type === "cmd") return "text-primary"
    if (type === "err") return "text-destructive"
    if (type === "sys") return "text-muted-foreground"
    return "text-foreground/90"
  }

  return (
    <div
      className="flex flex-col h-full bg-background/50 font-mono text-xs cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2 items-start leading-relaxed">
            <span className="text-muted-foreground/40 flex-shrink-0 text-[10px] pt-px">[{l.time}]</span>
            <span className={cn("break-all", lineColor(l.type))}>{l.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-border/50 flex items-center gap-2 px-3 py-2">
        <span className="text-primary flex-shrink-0">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          className="flex-1 bg-transparent outline-none text-xs font-mono text-foreground caret-primary"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
        <span className="w-1.5 h-3.5 bg-primary animate-pulse rounded-sm flex-shrink-0" />
      </div>
    </div>
  )
}
