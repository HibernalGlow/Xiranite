import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Archive, Clipboard, Copy, FileSearch, FolderOpen, HelpCircle, Layers, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea } from "@xiranite/ui"
import type { FindzAction, FindzData, FindzInput, FindzResult } from "./core.js"
import { formatFoundPath } from "./core.js"

interface FindzCardState {
  action?: FindzAction
  pathText?: string
  where?: string
  noArchive?: boolean
  followSymlinks?: boolean
  withImageMeta?: boolean
  longFormat?: boolean
  maxResults?: number
  maxReturnFiles?: number
  groupBy?: string
  refine?: string
  result?: FindzData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

const ACTIONS: Array<{ value: FindzAction; label: string; icon: typeof Search }> = [
  { value: "search", label: "Search", icon: Search },
  { value: "archives_only", label: "Archives", icon: Archive },
  { value: "nested", label: "Nested", icon: Layers },
]

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<FindzCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const action = data.action ?? "search"
  const paths = splitPaths(data.pathText)
  const where = data.where?.trim() || "1"
  const logs = data.logs ?? []
  const result = data.result ?? null

  function patch(patchData: Partial<FindzCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text })
  }

  async function execute(nextAction = action) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-findz CLI for filesystem search.")
      return
    }

    setRunning(true)
    patch({ phase: nextAction, progress: 0, progressText: "starting", result: null })
    const response = await runNode<FindzInput, FindzData>("findz", buildInput(nextAction, data), (event) => {
      if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      else log(event.message)
    }) as FindzResult

    patch({
      phase: response.success ? "completed" : "error",
      progress: response.success ? 100 : 0,
      progressText: response.message,
      result: response.data ?? null,
    })
    log(response.message)
    setRunning(false)
  }

  async function showHelp() {
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Filter help is available from `xiranite-findz help-filter`.")
      return
    }
    const response = await runNode<FindzInput, FindzData>("findz", { action: "help" }) as FindzResult
    patch({ result: response.data ?? null })
  }

  async function copyResults() {
    const text = (result?.files ?? []).map((file) => formatFoundPath(file)).join("\n")
    await host.clipboard?.writeText?.(text)
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
        title="findz"
        meta={`${action} / ${paths.length || 1} path(s) / ${where}`}
        actions={
          <>
            <IconButton title="Paste paths" disabled={running} onClick={pastePaths}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={running} onClick={() => execute()}><Play size={14} /> Run</ActionButton>
            <IconButton title="Filter help" disabled={running} onClick={showHelp}><HelpCircle size={14} /></IconButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><FileSearch size={14} /></IconButton>
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
          <SegmentButton active={data.noArchive ?? false} disabled={running || action !== "search"} onClick={() => patch({ noArchive: !(data.noArchive ?? false) })}>no archive</SegmentButton>
          <SegmentButton active={data.followSymlinks ?? false} disabled={running} onClick={() => patch({ followSymlinks: !(data.followSymlinks ?? false) })}>links</SegmentButton>
          <SegmentButton active={data.withImageMeta ?? false} disabled={running} onClick={() => patch({ withImageMeta: !(data.withImageMeta ?? false) })}>image meta</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="max" type="number" value={data.maxResults ?? 0} disabled={running} onChange={(event) => patch({ maxResults: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <Field label="return" type="number" value={data.maxReturnFiles ?? 5000} disabled={running} onChange={(event) => patch({ maxReturnFiles: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <Field label="group" value={data.groupBy ?? ""} disabled={running} onChange={(event) => patch({ groupBy: event.currentTarget.value })} placeholder="archive/ext/dir" className="min-w-0 flex-1" />
          <Field label="refine" value={data.refine ?? ""} disabled={running} onChange={(event) => patch({ refine: event.currentTarget.value })} placeholder="count > 10" className="min-w-0 flex-1" />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <TextArea
            label="paths"
            value={data.pathText ?? ""}
            disabled={running}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            placeholder="one folder or file per line"
          />
          <TextArea
            label="where"
            value={data.where ?? "1"}
            disabled={running}
            onChange={(event) => patch({ where: event.currentTarget.value })}
            placeholder={'ext IN ("jpg", "png") AND archive <> ""'}
          />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="total" value={result?.totalCount ?? 0} tone="accent" />
          <StatPill label="files" value={result?.fileCount ?? 0} tone="good" />
          <StatPill label="dirs" value={result?.dirCount ?? 0} />
          <StatPill label="archive" value={result?.archiveCount ?? 0} tone="accent" />
          <StatPill label="errors" value={result?.errors.length ?? 0} tone={(result?.errors.length ?? 0) ? "bad" : "neutral"} />
          <StatPill label="progress" value={`${data.progress ?? 0}%`} />
        </div>

        <ResultView className="h-24 shrink-0 text-muted-foreground">
          {result?.outputText && action === "help" ? (
            <pre className="whitespace-pre-wrap">{result.outputText}</pre>
          ) : result?.files.length ? result.files.slice(0, 80).map((file) => (
            <div key={`${file.container}:${file.path}`} className="mb-1 truncate">
              {file.type} {formatFoundPath(file)} <span className="text-muted-foreground/70">{file.sizeFormatted}</span>
            </div>
          )) : result?.groups.length ? result.groups.slice(0, 50).map((group) => (
            <div key={group.key} className="mb-1 truncate">{group.count} {group.name} / {group.avgSizeFormatted}</div>
          )) : (
            <div className="flex h-full items-center justify-center text-muted-foreground"><FolderOpen size={14} className="mr-2" />{data.progressText || "No search yet"}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function buildInput(action: FindzAction, data: FindzCardState): FindzInput {
  return {
    action,
    pathText: data.pathText,
    where: data.where || "1",
    noArchive: data.noArchive ?? false,
    followSymlinks: data.followSymlinks ?? false,
    withImageMeta: data.withImageMeta ?? false,
    longFormat: data.longFormat ?? true,
    maxResults: data.maxResults ?? 0,
    maxReturnFiles: data.maxReturnFiles ?? 5000,
    groupBy: data.groupBy || undefined,
    refine: data.refine || undefined,
  }
}

function splitPaths(text?: string): string[] {
  return (text ?? "").split(/\r?\n|[;]/).map((item) => item.trim()).filter(Boolean)
}
