import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Brush, Clipboard, Copy, Eye, Play, RotateCcw } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { CleanfData, CleanfInput, CleanfPresetId, CleanfResult } from "./core.js"
import { CLEANING_PRESETS, parseCleanfPaths } from "./core.js"

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

export function Component({ compId, host }: NodeComponentProps) {
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
    const input: CleanfInput = { paths, presets: selectedPresets, exclude: data.excludeKeywords, preview }
    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the xiranite-cleanf CLI to scan or remove files.")

    setRunning(true)
    patch({ phase: "running", progress: 0, progressText: preview ? "Previewing..." : "Cleaning...", result: null })
    const response = await runNativeAction<CleanfInput, CleanfData>("cleanf", input, (event) => {
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
    <NodeContent>
      <NodeHeader
        title="cleanf"
        meta={`${paths.length} path(s) / ${selectedPresets.length} preset(s) / ${previewMode ? "preview" : "delete"}`}
        actions={
          <>
            <IconButton title="Paste paths" onClick={pastePaths}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={!paths.length || running} onClick={() => execute()}><Play size={14} /> Run</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label="paths"
            value={pathText}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            disabled={running}
            placeholder="one folder path per line"
          />
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1">
              <SegmentButton active={previewMode} onClick={() => patch({ previewMode: !previewMode })}><Eye size={14} /> Preview</SegmentButton>
              <StatPill label="found" value={result?.totalRemoved ?? 0} tone="good" />
              <StatPill label="skipped" value={result?.skipped ?? 0} />
            </div>
            <Field label="exclude keywords" value={data.excludeKeywords ?? ""} disabled={running} onChange={(event) => patch({ excludeKeywords: event.currentTarget.value })} />
            <div className="min-h-0 flex-1 overflow-auto border-t border-border/40 pt-1">
              {Object.values(CLEANING_PRESETS).map((preset) => (
                <button
                  key={preset.id}
                  disabled={running}
                  onClick={() => togglePreset(preset.id)}
                  className={`mb-1 w-full truncate rounded px-2 py-1 text-left text-[11px] ${selectedPresets.includes(preset.id) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <ResultView className="h-20 shrink-0 text-muted-foreground">
          {result?.previewFiles?.length
            ? result.previewFiles.slice(0, 40).map((path) => <div key={path} className="truncate">{path}</div>)
            : Object.entries(result?.removedDetails ?? {}).map(([key, value]) => <div key={key}>{key}: {value}</div>)}
          {!result ? "No result" : null}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}
