import { useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clipboard, Copy, FileArchive, FolderOpen, MoveRight, PencilLine, Play, RotateCcw, Trash2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea } from "@xiranite/ui"
import type { MvzAction, MvzData, MvzInput, MvzResult } from "./core.js"
import { parseMvzEntries } from "./core.js"

interface MvzCardState {
  action?: MvzAction
  entryText?: string
  output?: string
  pattern?: string
  replacement?: string
  separator?: string
  near?: boolean
  autoDir?: boolean
  flatten?: boolean
  dryRun?: boolean
  result?: MvzData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

const ACTIONS: Array<{ value: MvzAction; label: string; icon: typeof FileArchive }> = [
  { value: "extract", label: "Extract", icon: FolderOpen },
  { value: "move", label: "Move", icon: MoveRight },
  { value: "delete", label: "Delete", icon: Trash2 },
  { value: "rename", label: "Rename", icon: PencilLine },
]

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<MvzCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const action = data.action ?? "extract"
  const separator = data.separator || "//"
  const entries = parseMvzEntries(data.entryText ?? "", separator)
  const archives = new Set(entries.map((entry) => entry.archivePath)).size
  const logs = data.logs ?? []
  const result = data.result ?? null
  const dryRun = data.dryRun ?? true

  function patch(patchData: Partial<MvzCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pasteEntries() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ entryText: text })
  }

  async function execute(nextAction = action) {
    if (running) return
    if (!host.runNode) {
      log("Host runner unavailable. Use the xiranite-mvz CLI for archive filesystem actions.")
      return
    }

    setRunning(true)
    patch({ phase: nextAction, progress: 0, progressText: "starting", result: null })
    const response = await host.runNode<MvzInput, MvzData>("mvz", buildInput(nextAction, data), (event) => {
      if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      else log(event.message)
    }) as MvzResult

    patch({
      phase: response.success ? "completed" : "error",
      progress: response.success ? 100 : 0,
      progressText: response.message,
      result: response.data ?? null,
    })
    log(response.message)
    setRunning(false)
  }

  async function copyResults() {
    const lines = [
      ...(result?.preview ?? []).map((item) => item.command ?? `${item.action} ${item.archive}`),
      ...(result?.results ?? []).map((item) => `${item.success ? "ok" : "fail"} ${item.action} ${item.archive} (${item.count}) ${item.message}`),
    ]
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  return (
    <NodeContent>
      <NodeHeader
        title="mvz"
        meta={`${action} / ${dryRun ? "dry-run" : "live"} / ${entries.length} file(s) / ${archives} archive(s)`}
        actions={
          <>
            <IconButton title="Paste findz entries" disabled={running} onClick={pasteEntries}><Clipboard size={14} /></IconButton>
            <ActionButton variant={action === "delete" && !dryRun ? "danger" : "primary"} disabled={running || !canRun(action, entries.length, data)} onClick={() => execute()}><Play size={14} /> Run</ActionButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><FileArchive size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          {ACTIONS.map((item) => {
            const Icon = item.icon
            return (
              <SegmentButton key={item.value} active={action === item.value} disabled={running} onClick={() => patch({ action: item.value })}>
                <Icon size={14} /> {item.label}
              </SegmentButton>
            )
          })}
          <SegmentButton active={dryRun} disabled={running} onClick={() => patch({ dryRun: !dryRun })}>dry-run</SegmentButton>
          <SegmentButton active={data.near ?? true} disabled={running || action === "delete" || action === "rename"} onClick={() => patch({ near: !(data.near ?? true) })}>near</SegmentButton>
          <SegmentButton active={data.autoDir ?? true} disabled={running || action === "delete" || action === "rename"} onClick={() => patch({ autoDir: !(data.autoDir ?? true) })}>auto dir</SegmentButton>
          <SegmentButton active={data.flatten ?? false} disabled={running || action === "delete" || action === "rename"} onClick={() => patch({ flatten: !(data.flatten ?? false) })}>flatten</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="output" value={data.output ?? ""} disabled={running || action === "delete" || action === "rename" || (data.near ?? true)} onChange={(event) => patch({ output: event.currentTarget.value })} className="min-w-[10rem] flex-1" />
          <Field label="separator" value={separator} disabled={running} onChange={(event) => patch({ separator: event.currentTarget.value })} className="w-24" />
          {action === "rename" ? (
            <>
              <Field label="pattern" value={data.pattern ?? ""} disabled={running} onChange={(event) => patch({ pattern: event.currentTarget.value })} className="min-w-[8rem] flex-1" />
              <Field label="replacement" value={data.replacement ?? ""} disabled={running} onChange={(event) => patch({ replacement: event.currentTarget.value })} className="min-w-[8rem] flex-1" />
            </>
          ) : null}
        </div>

        <TextArea
          label="archive entries"
          value={data.entryText ?? ""}
          disabled={running}
          onChange={(event) => patch({ entryText: event.currentTarget.value })}
          placeholder="C:/packs/book.zip//chapter/page.jpg"
        />

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="success" value={result?.successCount ?? 0} tone="good" />
          <StatPill label="failed" value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
          <StatPill label="archives" value={result?.totalArchives ?? archives} tone="accent" />
          <StatPill label="files" value={result?.totalFiles ?? entries.length} />
          <StatPill label="progress" value={`${data.progress ?? 0}%`} />
        </div>

        <ResultView className="h-24 shrink-0 text-muted-foreground">
          {result?.preview.length ? result.preview.slice(0, 80).map((item) => (
            <div key={`${item.action}:${item.archive}:${item.command ?? ""}`} className="mb-1 truncate">
              plan {item.action} {item.count} / {item.command}
            </div>
          )) : result?.results.length ? result.results.slice(0, 80).map((item) => (
            <div key={`${item.action}:${item.archive}:${item.message}`} className={item.success ? "mb-1 truncate" : "mb-1 truncate text-red-500"}>
              {item.success ? "ok" : "fail"} {item.action} {item.archive} / {item.message}
            </div>
          )) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">{data.progressText || "No operation yet"}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function canRun(action: MvzAction, entryCount: number, data: MvzCardState): boolean {
  if (!entryCount) return false
  if (action === "rename") return Boolean(data.pattern)
  return true
}

function buildInput(action: MvzAction, data: MvzCardState): MvzInput {
  return {
    action,
    fileText: data.entryText,
    output: data.output,
    near: data.near ?? true,
    autoDir: data.autoDir ?? true,
    flatten: data.flatten ?? false,
    pattern: data.pattern,
    replacement: data.replacement ?? "",
    separator: data.separator || "//",
    dryRun: data.dryRun ?? true,
  }
}
