import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Copy, FolderTree, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { SeriexData, SeriexInput, SeriexResult } from "./core.js"

interface SeriexCardState {
  directoryPath?: string
  configPath?: string
  knownSeriesText?: string
  prefix?: string
  result?: SeriexData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<SeriexCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const planItems = data.result?.planItems ?? []
  const moveItems = data.result?.moveItems ?? []

  function patch(patchData: Partial<SeriexCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function execute(action: SeriexInput["action"], dryRun = false) {
    if (running) return
    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")
    setRunning(true)
    patch({ phase: "running" })
    const response = await runNativeAction<SeriexInput, SeriexData>("seriex", {
      action,
      directoryPath: data.directoryPath,
      configPath: data.configPath,
      knownSeriesNames: splitLines(data.knownSeriesText),
      prefix: data.prefix || "[#s]",
      dryRun,
    }, (event) => {
      if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
      else log(event.message)
    }) as SeriexResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  async function paste(field: "directoryPath" | "configPath" | "knownSeriesText") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:seriex.title")}
        meta={t("module:seriex.meta", { phase: data.phase ?? t("module:seriex.idle"), count: planItems.length || moveItems.length })}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("plan", true)}><Search size={14} /> {t("module:seriex.plan")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("execute")}><Play size={14} /> {t("module:seriex.apply")}</ActionButton>
            <IconButton title={t("module:seriex.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title={t("module:seriex.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <PathField label={t("module:seriex.directory")} pasteTitle={t("module:seriex.pasteDirectory")} value={data.directoryPath ?? ""} disabled={running} onChange={(value) => patch({ directoryPath: value })} onPaste={() => paste("directoryPath")} />
          <PathField label={t("module:seriex.config")} pasteTitle={t("module:seriex.pasteConfig")} value={data.configPath ?? ""} disabled={running} onChange={(value) => patch({ configPath: value })} onPaste={() => paste("configPath")} />
          <Field label={t("module:seriex.prefix")} value={data.prefix ?? "[#s]"} disabled={running} onChange={(event) => patch({ prefix: event.currentTarget.value })} className="min-w-0 flex-1" />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1">
              <StatPill label={t("module:seriex.statSeries")} value={data.result?.totalSeries ?? 0} tone="accent" />
              <StatPill label={t("module:seriex.statFiles")} value={data.result?.totalFiles ?? 0} />
              <StatPill label={t("module:seriex.statMoved")} value={data.result?.movedCount ?? 0} tone="good" />
              <StatPill label={t("module:seriex.statFailed")} value={data.result?.failedCount ?? 0} tone={data.result?.failedCount ? "bad" : "neutral"} />
            </div>
            <ResultView className="flex-1 text-muted-foreground">
              {planItems.length ? planItems.slice(0, 40).map((item) => (
                <div key={`${item.directory}:${item.folder}`} className="mb-2">
                  <div className="truncate text-primary">{item.folder}</div>
                  <div className="truncate">{t("module:seriex.planFiles", { count: item.files.length, directory: item.directory })}</div>
                </div>
              )) : moveItems.length ? moveItems.slice(0, 40).map((item) => (
                <div key={`${item.sourcePath}:${item.targetPath}`} className="mb-1 truncate">
                  {t("module:seriex.moveResult", { status: t(item.success ? "module:seriex.ok" : "module:seriex.fail"), filename: item.filename, folder: item.folder })}
                </div>
              )) : t("module:seriex.noResult")}
            </ResultView>
          </div>
          <TextArea
            label={t("module:seriex.knownSeries")}
            value={data.knownSeriesText ?? ""}
            disabled={running}
            onChange={(event) => patch({ knownSeriesText: event.currentTarget.value })}
            className="min-w-0 flex-1"
          />
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function PathField(props: { label: string; pasteTitle: string; value: string; disabled: boolean; onChange: (value: string) => void; onPaste: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      <Field label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} className="min-w-0 flex-1" />
      <IconButton title={props.pasteTitle} onClick={props.onPaste} disabled={props.disabled}><FolderTree size={13} /></IconButton>
    </div>
  )
}

function splitLines(value?: string): string[] {
  return (value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}
