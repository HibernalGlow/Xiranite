import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clock, Copy, Play, RotateCcw, Trash2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { RecycleuData, RecycleuInput, RecycleuResult } from "./core.js"

interface RecycleuCardState {
  interval?: number
  maxCycles?: number
  driveLetter?: string
  cleanCount?: number
  lastCleanTime?: string | null
  phase?: string
  logs?: string[]
  progress?: number
  progressText?: string
  remainingSeconds?: number
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<RecycleuCardState>(compId) ?? {}
  const dataRef = useRef<RecycleuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const interval = data.interval ?? 10
  const maxCycles = data.maxCycles ?? 1
  const phase = running ? "running" : (data.phase ?? "idle")
  const logs = data.logs ?? []
  const cleanCount = data.cleanCount ?? 0
  const driveLetter = data.driveLetter ?? ""
  const remainingSeconds = data.remainingSeconds ?? interval
  const ringProgress = running ? Math.max(0, Math.min(100, (remainingSeconds / interval) * 100)) : 100

  function patch(patchData: Partial<RecycleuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function appendLog(message: string, patchData: Partial<RecycleuCardState> = {}) {
    const current = dataRef.current.logs ?? []
    patch({ ...patchData, logs: [...current.slice(-40), message] })
  }

  async function execute(input: RecycleuInput) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for system actions.")
    const request: RecycleuInput = {
      ...input,
      driveLetter: driveLetter || undefined,
    }

    setRunning(true)
    patch({ phase: "running", progress: 0, progressText: t("module:recycleu.starting") })
    try {
      const result = await runNativeAction<RecycleuInput, RecycleuData>("recycleu", request, (event) => {
        const seconds = event.message.match(/(\d+)s/)?.[1]
        if (event.type === "progress") {
          patch({
            progress: event.progress ?? 0,
            progressText: event.message,
            remainingSeconds: seconds ? Number(seconds) : dataRef.current.remainingSeconds ?? remainingSeconds,
          })
          appendLog(event.message)
        } else {
          appendLog(event.message)
        }
      }) as RecycleuResult

      appendLog(result.message, {
        phase: result.success ? "completed" : "error",
        progress: result.success ? 100 : 0,
        progressText: result.message,
        cleanCount: result.data?.cleanCount ?? cleanCount,
        lastCleanTime: result.data?.lastCleanTime ?? data.lastCleanTime ?? null,
        remainingSeconds: interval,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendLog(message, { phase: "error", progress: 0, progressText: message })
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", cleanCount: 0, lastCleanTime: null, logs: [], remainingSeconds: interval })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:recycleu.title")}
        meta={t("module:recycleu.meta", { phase, interval })}
        actions={
          <>
            <ActionButton variant="primary" disabled={running} onClick={() => execute({ action: "start", interval, maxCycles })}><Play size={14} /> {t("module:recycleu.start")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute({ action: "clean_now" })}><Trash2 size={14} /> {t("module:recycleu.clean")}</ActionButton>
            <IconButton title={t("module:recycleu.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title={t("module:recycleu.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:recycleu.intervalSeconds")} type="number" min={5} max={3600} value={interval} disabled={running} onChange={(event) => patch({ interval: Number(event.currentTarget.value) || 10 })} className="flex-1" />
          <Field label={t("module:recycleu.cycles")} type="number" min={1} max={360} value={maxCycles} disabled={running} onChange={(event) => patch({ maxCycles: Math.max(1, Number(event.currentTarget.value) || 1) })} className="w-20" />
          <Field label={t("module:recycleu.driveLetter")} value={driveLetter} maxLength={2} disabled={running} onChange={(event) => patch({ driveLetter: event.currentTarget.value.toUpperCase().replace(/[^A-Z:]/g, "").slice(0, 2) })} className="w-20" />
          {[5, 10, 30, 60].map((value) => (
            <SegmentButton key={value} active={interval === value} disabled={running} onClick={() => patch({ interval: value })}>
              {value < 60 ? `${value}s` : "1m"}
            </SegmentButton>
          ))}
        </div>

        <div className="min-h-0 flex flex-1 flex-col items-stretch gap-2">
          <div className="relative h-28 w-28 shrink-0">
            <svg className="-rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/40" />
              <circle
                cx="50"
                cy="50"
                r="43"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={`${ringProgress * 2.7} 270`}
                strokeLinecap="round"
                className={phase === "error" ? "text-red-500" : phase === "completed" ? "text-green-500" : "text-primary"}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {running ? <span className="text-lg font-bold">{remainingSeconds}s</span> : <Trash2 size={28} className="text-muted-foreground" />}
              <span className="text-[10px] text-muted-foreground">{t("module:recycleu.runs", { count: cleanCount })}</span>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap gap-1">
              <StatPill label={t("module:recycleu.phase")} value={phase} tone={phase === "error" ? "bad" : phase === "completed" ? "good" : "neutral"} />
              <StatPill label={t("module:recycleu.last")} value={data.lastCleanTime ?? "-"} />
              <StatPill label={t("module:recycleu.progress")} value={`${data.progress ?? 0}%`} tone="accent" />
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{data.progressText || t("module:recycleu.waiting")}</div>
          </div>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}
