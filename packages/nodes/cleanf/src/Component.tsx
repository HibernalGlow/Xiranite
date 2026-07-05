import { useState } from "react"
import type { ReactNode } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Brush, Clipboard, Copy, Eye, Play, RotateCcw } from "lucide-react"
import type { CleanfData, CleanfInput, CleanfPresetId, CleanfResult } from "./core.js"
import { CLEANING_PRESETS, getDefaultPresets, parseCleanfPaths } from "./core.js"

interface CleanfCardState {
  pathText?: string
  selectedPresets?: CleanfPresetId[]
  excludeKeywords?: string
  previewMode?: boolean
  result?: CleanfData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<CleanfCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const pathText = data.pathText ?? ""
  const selectedPresets = data.selectedPresets ?? ["empty_folders", "backup_files"]
  const previewMode = data.previewMode ?? true
  const logs = data.logs ?? []
  const result = data.result ?? null
  const paths = parseCleanfPaths(pathText)

  function patch(patchData: Partial<CleanfCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: pathText ? `${pathText}\n${text}` : text })
  }

  function togglePreset(id: CleanfPresetId) {
    patch({
      selectedPresets: selectedPresets.includes(id)
        ? selectedPresets.filter((preset) => preset !== id)
        : [...selectedPresets, id],
    })
  }

  async function execute(preview = previewMode) {
    if (!paths.length || running) return
    const input: CleanfInput = {
      paths,
      presets: selectedPresets,
      exclude: data.excludeKeywords,
      preview,
    }

    if (!host.runNode) {
      log("Host runner unavailable. Use the xiranite-cleanf CLI to scan or remove files.")
      return
    }

    setRunning(true)
    patch({ phase: "running", progress: 0, progressText: preview ? "Previewing..." : "Cleaning...", result: null })
    const response = await host.runNode<CleanfInput, CleanfData>("cleanf", input, (event) => {
      if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      else log(event.message)
    }) as CleanfResult

    patch({
      phase: response.success ? "completed" : "error",
      progress: response.success ? 100 : 0,
      progressText: response.message,
      result: response.data ?? null,
    })
    log(response.message)
    setRunning(false)
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <div className="h-full min-h-[320px] overflow-hidden p-3 text-xs font-mono">
      <div className="grid h-full min-h-0 grid-cols-[1.1fr_1fr_130px] grid-rows-[1fr_120px] gap-2">
        <Panel title="Source" action={<button title="Paste paths" onClick={pastePaths}><Clipboard size={13} /></button>}>
          <textarea
            value={pathText}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            disabled={running}
            className="h-full w-full resize-none rounded border border-border bg-muted/30 p-2 text-xs outline-none"
            placeholder="one folder path per line"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">{paths.length} path(s)</div>
        </Panel>
        <Panel title="Presets">
          <div className="grid h-full auto-rows-min gap-1 overflow-auto pr-1">
            {Object.values(CLEANING_PRESETS).map((preset) => (
              <button
                key={preset.id}
                disabled={running}
                onClick={() => togglePreset(preset.id)}
                className={`rounded border p-2 text-left transition-colors ${selectedPresets.includes(preset.id) ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
              >
                <div className="font-semibold">{preset.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">{preset.description}</div>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Options">
          <div className="flex h-full flex-col gap-2">
            <button className={`flex h-8 items-center justify-center gap-1 rounded border ${previewMode ? "border-primary bg-primary/10" : "border-border"}`} onClick={() => patch({ previewMode: !previewMode })}>
              <Eye size={14} /> Preview
            </button>
            <input
              value={data.excludeKeywords ?? ""}
              onChange={(event) => patch({ excludeKeywords: event.currentTarget.value })}
              placeholder="exclude, comma"
              disabled={running}
              className="h-8 rounded border border-border bg-background px-2 outline-none"
            />
            <button className="mt-auto flex flex-1 items-center justify-center gap-1 rounded bg-primary text-primary-foreground disabled:opacity-50" disabled={!paths.length || running} onClick={() => execute()}>
              <Play size={14} /> {previewMode ? "Preview" : "Clean"}
            </button>
            <button className="flex h-8 items-center justify-center gap-1 rounded border border-border" onClick={reset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </Panel>
        <Panel title="Result" className="col-span-2">
          <div className="grid h-full grid-cols-[150px_1fr] gap-2">
            <div className="rounded border border-border bg-muted/20 p-2">
              <div className="text-[10px] text-muted-foreground">total</div>
              <div className="text-2xl font-bold text-green-600">{result?.totalRemoved ?? 0}</div>
              <div className="text-[10px] text-muted-foreground">skipped {result?.skipped ?? 0}</div>
            </div>
            <div className="overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
              {result?.previewFiles?.length
                ? result.previewFiles.slice(0, 60).map((path) => <div key={path}>{path}</div>)
                : Object.entries(result?.removedDetails ?? {}).map(([key, value]) => <div key={key}>{key}: {value}</div>)}
              {!result ? "No result" : null}
            </div>
          </div>
        </Panel>
        <Panel title="Log" icon={<Brush size={14} />} action={<button title="Copy logs" onClick={copyLogs}><Copy size={13} /></button>}>
          <div className="h-full overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
            {running ? <div>[{data.progress ?? 0}%] {data.progressText}</div> : null}
            {logs.length ? logs.slice(-10).map((line) => <div key={line}>{line}</div>) : "No logs"}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Panel(props: { title: string; icon?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col gap-2 rounded border border-border bg-card/40 p-2 ${props.className ?? ""}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-semibold">{props.icon}{props.title}</span>
        {props.action ? <div className="text-muted-foreground">{props.action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </section>
  )
}
