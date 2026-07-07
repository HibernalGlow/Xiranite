import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FileArchive, FolderOpen, Package, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill } from "@xiranite/ui"
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
  const { t } = useTranslation()
  const data = host.getData<RepackuCardState>(compId) ?? {}
  const dataRef = useRef<RepackuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const result = data.result ?? null
  const logs = data.logs ?? []
  const types = parseTypes(data.typesText)

  function patch(patchData: Partial<RepackuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    patch({ path: text.trim() })
  }

  async function execute(action: RepackuAction) {
    if (running) return
    const input = buildInput(action, data)
    if (action !== "compress" && !input.path && !input.paths?.length) {
      log(t("module:repacku.pathRequired"))
      patch({ progressText: t("module:repacku.pathRequired") })
      return
    }
    if (action === "compress" && !input.configPath && !input.path && !input.paths?.length) {
      log(t("module:repacku.configOrPathRequired"))
      patch({ progressText: t("module:repacku.configOrPathRequired") })
      return
    }

    const runAction = host.actions?.run
    if (!runAction) {
      const message = t("module:repacku.nativeUnavailable")
      log(message)
      patch({ phase: "error", progress: 0, progressText: message })
      return
    }

    setRunning(true)
    let nextLogs = [...(dataRef.current.logs ?? [])]
    const pushLog = (message: string) => {
      nextLogs = [...nextLogs.slice(-40), message]
      patch({ logs: nextLogs })
    }

    patch({ phase: action, progress: 0, progressText: t("module:repacku.starting"), result: null, logs: nextLogs })
    try {
      const response = await runAction<RepackuInput, RepackuData>("repacku", input, (event) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
        else pushLog(event.message)
      }) as RepackuResult

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
        configPath: response.data?.configPath || data.configPath,
      })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
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
        title={t("module:repacku.title")}
        meta={t("module:repacku.meta", { types: types.length ? types.join(", ") : t("module:repacku.allFiles"), minCount: data.minCount ?? 2, mode: data.dryRun ? t("module:repacku.dryRunMode") : t("module:repacku.write") })}
        actions={
          <>
            <IconButton title={t("module:repacku.pastePath")} disabled={running} onClick={pastePath}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !data.path} onClick={() => execute("analyze")}><Search size={14} /> {t("module:repacku.analyze")}</ActionButton>
            <ActionButton variant="primary" disabled={running || !data.path} onClick={() => execute("full")}><Play size={14} /> {t("module:repacku.full")}</ActionButton>
            <ActionButton disabled={running || (!data.configPath && !data.path)} onClick={() => execute("compress")}><FileArchive size={14} /> {t("module:repacku.compress")}</ActionButton>
            <IconButton title={t("module:repacku.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:repacku.copyLogs")} onClick={copyLogs}><FolderOpen size={14} /></IconButton>
            <IconButton title={t("module:repacku.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:repacku.folderPath")} value={data.path ?? ""} disabled={running} onChange={(event) => patch({ path: event.currentTarget.value })} />
          <Field label={t("module:repacku.configJson")} value={data.configPath ?? ""} disabled={running} onChange={(event) => patch({ configPath: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:repacku.types")} value={data.typesText ?? ""} disabled={running} placeholder="image,document" onChange={(event) => patch({ typesText: event.currentTarget.value })} />
          <Field label={t("module:repacku.minFiles")} type="number" min={1} value={data.minCount ?? 2} disabled={running} onChange={(event) => patch({ minCount: Number(event.currentTarget.value) })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.dryRun ?? true} disabled={running} onClick={() => patch({ dryRun: !(data.dryRun ?? true) })}>{t("module:repacku.dryRun")}</SegmentButton>
          <SegmentButton active={data.deleteAfter ?? false} disabled={running} onClick={() => patch({ deleteAfter: !(data.deleteAfter ?? false) })}>{t("module:repacku.deleteAfter")}</SegmentButton>
          <ActionButton disabled={running || !data.path} onClick={() => execute("single-pack")}><Package size={14} /> {t("module:repacku.single")}</ActionButton>
          <ActionButton disabled={running || !data.path} onClick={() => execute("gallery-pack")}><FolderOpen size={14} /> {t("module:repacku.gallery")}</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:repacku.folders")} value={result?.totalFolders ?? 0} tone="accent" />
          <StatPill label={t("module:repacku.entire")} value={result?.entireCount ?? 0} tone="good" />
          <StatPill label={t("module:repacku.selective")} value={result?.selectiveCount ?? 0} />
          <StatPill label={t("module:repacku.ops")} value={result?.totalOperations ?? 0} />
          <StatPill label={t("module:repacku.failed")} value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
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
            <div className="flex h-full items-center justify-center text-muted-foreground">{data.progressText || t("module:repacku.readyToAnalyze")}</div>
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
