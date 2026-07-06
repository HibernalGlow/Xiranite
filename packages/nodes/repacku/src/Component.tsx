import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FileArchive, FolderOpen, Package, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNodeRunner } from "@xiranite/ui"
import type { RepackuAction, RepackuData, RepackuFolderNode, RepackuInput, RepackuResult } from "./core.js"

interface RepackuCardState {
  path?: string
  configPath?: string
  typesText?: string
  minCount?: number
  deleteAfter?: boolean
  dryRun?: boolean
  phase?: string
  progress?: number
  progressText?: string
  result?: RepackuData | null
  logs?: string[]
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<RepackuCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const result = data.result ?? null
  const logs = data.logs ?? []
  const types = parseTypes(data.typesText)

  function patch(patchData: Partial<RepackuCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    patch({ path: text.trim() })
  }

  async function execute(action: RepackuAction) {
    if (running) return
    const runNode = createUnavailableNodeRunner("Native action is unavailable in the shell-less Component. Use the xiranite-repacku CLI for filesystem actions.")

    const input = buildInput(action, data)
    if (action !== "compress" && !input.path && !input.paths?.length) return
    if (action === "compress" && !input.configPath && !input.path && !input.paths?.length) return

    setRunning(true)
    patch({ phase: action, progress: 0, progressText: "starting", result: null })
    const response = await runNode<RepackuInput, RepackuData>("repacku", input, (event) => {
      if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      else log(event.message)
    }) as RepackuResult

    patch({
      phase: response.success ? "completed" : "error",
      progress: response.success ? 100 : 0,
      progressText: response.message,
      result: response.data ?? null,
      configPath: response.data?.configPath || data.configPath,
    })
    log(response.message)
    setRunning(false)
  }

  async function copyResults() {
    const text = [
      result?.configPath ? `config=${result.configPath}` : "",
      ...(result?.operations ?? []).map((item) => `${item.status} ${item.mode} ${item.sourcePath} -> ${item.targetPath}`),
    ].filter(Boolean).join("\n")
    if (text) await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  const treeLines = result?.folderTree ? flattenTree(result.folderTree).slice(0, 48) : []

  return (
    <NodeContent>
      <NodeHeader
        title="repacku"
        meta={`${types.length ? types.join(", ") : "all files"} / min ${data.minCount ?? 2} / ${data.dryRun ? "dry-run" : "write"}`}
        actions={
          <>
            <IconButton title="Paste path" disabled={running} onClick={pastePath}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !data.path} onClick={() => execute("analyze")}><Search size={14} /> Analyze</ActionButton>
            <ActionButton variant="primary" disabled={running || !data.path} onClick={() => execute("full")}><Play size={14} /> Full</ActionButton>
            <ActionButton disabled={running || (!data.configPath && !data.path)} onClick={() => execute("compress")}><FileArchive size={14} /> Compress</ActionButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><FolderOpen size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="folder path" value={data.path ?? ""} disabled={running} onChange={(event) => patch({ path: event.currentTarget.value })} />
          <Field label="config json" value={data.configPath ?? ""} disabled={running} onChange={(event) => patch({ configPath: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="types" value={data.typesText ?? ""} disabled={running} placeholder="image,document" onChange={(event) => patch({ typesText: event.currentTarget.value })} />
          <Field label="min files" type="number" min={1} value={data.minCount ?? 2} disabled={running} onChange={(event) => patch({ minCount: Number(event.currentTarget.value) })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.dryRun ?? true} disabled={running} onClick={() => patch({ dryRun: !(data.dryRun ?? true) })}>dry run</SegmentButton>
          <SegmentButton active={data.deleteAfter ?? false} disabled={running} onClick={() => patch({ deleteAfter: !(data.deleteAfter ?? false) })}>delete after</SegmentButton>
          <ActionButton disabled={running || !data.path} onClick={() => execute("single-pack")}><Package size={14} /> Single</ActionButton>
          <ActionButton disabled={running || !data.path} onClick={() => execute("gallery-pack")}><FolderOpen size={14} /> Gallery</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="folders" value={result?.totalFolders ?? 0} tone="accent" />
          <StatPill label="entire" value={result?.entireCount ?? 0} tone="good" />
          <StatPill label="selective" value={result?.selectiveCount ?? 0} />
          <StatPill label="ops" value={result?.totalOperations ?? 0} />
          <StatPill label="failed" value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {running ? (
            <div>{`[${data.progress ?? 0}%] ${data.progressText ?? ""}`}</div>
          ) : result?.operations.length ? (
            result.operations.slice(0, 60).map((item, index) => (
              <div key={`${index}:${item.sourcePath}`} className="truncate">
                {item.status} {item.mode} {item.sourcePath} -&gt; {item.targetPath}
              </div>
            ))
          ) : treeLines.length ? (
            treeLines.map((line) => <div key={line} className="truncate">{line}</div>)
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">{data.progressText || "Ready to analyze or repack folders."}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function buildInput(action: RepackuAction, data: RepackuCardState): RepackuInput {
  return {
    action,
    path: data.path,
    configPath: data.configPath,
    types: data.typesText,
    minCount: data.minCount ?? 2,
    deleteAfter: data.deleteAfter ?? false,
    dryRun: data.dryRun ?? true,
  }
}

function parseTypes(value = ""): string[] {
  return value.split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean)
}

function flattenTree(root: RepackuFolderNode): string[] {
  const lines: string[] = []
  function walk(node: RepackuFolderNode, depth: number) {
    lines.push(`${"  ".repeat(depth)}${node.compressMode.padEnd(9)} ${node.name} (${node.totalFiles})`)
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return lines
}
