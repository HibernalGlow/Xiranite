import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { i18n as I18nInstance } from "i18next"
import { cn } from "@/lib/utils"
import { MODULE_REGISTRY } from "@/components/modules/registry"

interface TerminalLine {
  type: "cmd" | "out" | "err" | "sys"
  text: string
  time: string
}

function useTerminalCommands(t: ReturnType<typeof useTranslation>["t"], i18n: I18nInstance) {
  return {
    motd: [
      { type: "sys" as const, text: t("module:terminal.motd1") },
      { type: "sys" as const, text: t("module:terminal.motd2") },
    ],
    commands: {
      help: () => [
        t("module:terminal.help.available"),
        t("module:terminal.help.help"),
        t("module:terminal.help.echo"),
        t("module:terminal.help.clear"),
        t("module:terminal.help.date"),
        t("module:terminal.help.whoami"),
        t("module:terminal.help.status"),
        t("module:terminal.help.ls"),
      ],
      echo: (args: string[]) => [args.join(" ")],
      date: () => [new Date().toString()],
      whoami: () => [t("module:terminal.whoami")],
      status: () => t("module:terminal.status", { returnObjects: true }) as string[],
      ls: () => {
        const names = MODULE_REGISTRY.map(m => i18n.exists(`module:${m.id}.name`) ? t(`module:${m.id}.name`) : m.name)
        const half = Math.ceil(names.length / 2)
        return [
          names.slice(0, half).join("    "),
          names.slice(half).join("    "),
        ]
      },
    } as Record<string, (args: string[]) => string[]>,
  }
}

function timestamp(locale: string) {
  return new Date().toLocaleTimeString(locale, { hour12: false })
}

export default function TerminalModule() {
  const { t, i18n } = useTranslation()
  const { motd, commands: COMMANDS } = useTerminalCommands(t, i18n)
  const locale = i18n.language === "zh" ? "zh-CN" : "en-US"
  const [lines, setLines] = useState<TerminalLine[]>(
    motd.map(l => ({ ...l, time: timestamp(locale) }))
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

    setLines(ls => [...ls, { type: "cmd", text: `$ ${trimmed}`, time: timestamp(locale) }])
    setHistory(h => [trimmed, ...h.slice(0, 49)])
    setHistIdx(-1)

    if (cmd === "clear") {
      setLines([])
      return
    }

    const handler = COMMANDS[cmd.toLowerCase()]
    if (handler) {
      const out = handler(args)
      setLines(ls => [...ls, ...out.map(t => ({ type: "out" as const, text: t, time: timestamp(locale) }))])
    } else {
      setLines(ls => [...ls, { type: "err", text: t("module:terminal.notFound", { cmd }), time: timestamp(locale) }])
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
