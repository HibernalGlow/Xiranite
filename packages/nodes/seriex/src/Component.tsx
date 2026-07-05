import { useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Copy, FolderTree, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill, TextArea } from "@xiranite/ui"
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

export function Component({ compId, host }: NodeCardProps) {
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
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-seriex CLI for filesystem actions.")
      return
    }
    setRunning(true)
    patch({ phase: "running" })
    const response = await runNode<SeriexInput, SeriexData>("seriex", {
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
        title="seriex"
        meta={`${data.phase ?? "idle"} / ${planItems.length || moveItems.length} group(s)`}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("plan", true)}><Search size={14} /> Plan</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("execute")}><Play size={14} /> Apply</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <PathField label="directory" value={data.directoryPath ?? ""} disabled={running} onChange={(value) => patch({ directoryPath: value })} onPaste={() => paste("directoryPath")} />
          <PathField label="config" value={data.configPath ?? ""} disabled={running} onChange={(value) => patch({ configPath: value })} onPaste={() => paste("configPath")} />
          <Field label="prefix" value={data.prefix ?? "[#s]"} disabled={running} onChange={(event) => patch({ prefix: event.currentTarget.value })} className="min-w-0 flex-1" />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1">
              <StatPill label="series" value={data.result?.totalSeries ?? 0} tone="accent" />
              <StatPill label="files" value={data.result?.totalFiles ?? 0} />
              <StatPill label="moved" value={data.result?.movedCount ?? 0} tone="good" />
              <StatPill label="failed" value={data.result?.failedCount ?? 0} tone={data.result?.failedCount ? "bad" : "neutral"} />
            </div>
            <ResultView className="flex-1 text-muted-foreground">
              {planItems.length ? planItems.slice(0, 40).map((item) => (
                <div key={`${item.directory}:${item.folder}`} className="mb-2">
                  <div className="truncate text-primary">{item.folder}</div>
                  <div className="truncate">{item.files.length} file(s) / {item.directory}</div>
                </div>
              )) : moveItems.length ? moveItems.slice(0, 40).map((item) => (
                <div key={`${item.sourcePath}:${item.targetPath}`} className="mb-1 truncate">
                  {item.success ? "OK" : "FAIL"} {item.filename} -&gt; {item.folder}
                </div>
              )) : "No result"}
            </ResultView>
          </div>
          <TextArea
            label="known series"
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

function PathField(props: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; onPaste: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      <Field label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} className="min-w-0 flex-1" />
      <IconButton title={`Paste ${props.label}`} onClick={props.onPaste} disabled={props.disabled}><FolderTree size={13} /></IconButton>
    </div>
  )
}

function splitLines(value?: string): string[] {
  return (value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}
