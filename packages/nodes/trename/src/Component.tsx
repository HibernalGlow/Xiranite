import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FilePenLine, FolderOpen, Play, RefreshCw, RotateCcw, Search, Undo2, Upload } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { TrenameAction, TrenameData, TrenameInput, TrenameJson, TrenameNode, TrenameResult } from "./core.js"

interface TrenameCardState {
  pathText?: string
  basePath?: string
  jsonText?: string
  includeHidden?: boolean
  includeRoot?: boolean
  compact?: boolean
  dryRun?: boolean
  excludeExts?: string
  excludePatterns?: string
  maxLines?: number
  batchId?: string
  undoPath?: string
  phase?: string
  progress?: number
  progressText?: string
  result?: TrenameData | null
  logs?: string[]
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<TrenameCardState>(compId) ?? {}
  const dataRef = useRef<TrenameCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const result = data.result ?? null
  const logs = data.logs ?? []
  const jsonText = data.jsonText ?? result?.jsonContent ?? ""
  const summary = summarizeJson(jsonText)

  function patch(patchData: Partial<TrenameCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function pasteJson() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ jsonText: text })
  }

  async function copyJson() {
    if (jsonText) await host.clipboard?.writeText?.(jsonText)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function execute(action: TrenameAction) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")
    const input = buildInput(action, data, jsonText)
    if (action === "scan" && !input.paths) return
    if ((action === "import" || action === "validate" || action === "rename") && !input.jsonContent) return

    setRunning(true)
    try {
      patch({ phase: action, progress: 0, progressText: t("module:trename.starting") })
      const response = await runNativeAction<TrenameInput, TrenameData>("trename", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          log(`[${event.progress ?? 0}%] ${event.message}`)
        }
        else log(event.message)
      }) as TrenameResult
  
      const next = response.data ?? null
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: next,
        jsonText: next?.jsonContent || jsonText,
        basePath: next?.basePath || data.basePath,
        batchId: next?.operationId || data.batchId,
      })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, jsonText: "", logs: [] })
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:trename.title")}
        meta={t("module:trename.meta", {
          total: result?.totalItems ?? summary.total,
          ready: result?.readyCount ?? summary.ready,
          conflicts: result?.conflicts.length ?? 0,
        })}
        actions={
          <>
            <IconButton title={t("module:trename.pastePath")} disabled={running} onClick={pastePath}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !data.pathText} onClick={() => execute("scan")}><RefreshCw size={14} /> {t("module:trename.scan")}</ActionButton>
            <ActionButton disabled={running} onClick={pasteJson}><Upload size={14} /> {t("module:trename.json")}</ActionButton>
            <ActionButton disabled={running || !jsonText} onClick={() => execute("validate")}><Search size={14} /> {t("module:trename.validate")}</ActionButton>
            <ActionButton variant="primary" disabled={running || !jsonText} onClick={() => execute("rename")}><Play size={14} /> {t("module:trename.rename")}</ActionButton>
            <IconButton title={t("module:trename.copyJson")} onClick={copyJson}><Copy size={14} /></IconButton>
            <IconButton title={t("module:trename.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:trename.scanPaths")} value={data.pathText ?? ""} disabled={running} placeholder={'"D:\\a" "D:\\b"'} onChange={(event) => patch({ pathText: event.currentTarget.value })} />
          <Field label={t("module:trename.basePath")} value={data.basePath ?? ""} disabled={running} onChange={(event) => patch({ basePath: event.currentTarget.value })} />
          <Field label={t("module:trename.batchId")} value={data.batchId ?? ""} disabled={running} onChange={(event) => patch({ batchId: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:trename.excludeExt")} value={data.excludeExts ?? ".json,.txt,.html,.htm,.md,.log"} disabled={running} onChange={(event) => patch({ excludeExts: event.currentTarget.value })} />
          <Field label={t("module:trename.excludePattern")} value={data.excludePatterns ?? ""} disabled={running} placeholder="processed,numbered" onChange={(event) => patch({ excludePatterns: event.currentTarget.value })} />
          <Field label={t("module:trename.splitLines")} type="number" value={data.maxLines ?? 1000} disabled={running} onChange={(event) => patch({ maxLines: Number(event.currentTarget.value) })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.includeRoot ?? true} disabled={running} onClick={() => patch({ includeRoot: !(data.includeRoot ?? true) })}>{t("module:trename.root")}</SegmentButton>
          <SegmentButton active={data.includeHidden ?? false} disabled={running} onClick={() => patch({ includeHidden: !(data.includeHidden ?? false) })}>{t("module:trename.hidden")}</SegmentButton>
          <SegmentButton active={data.compact ?? true} disabled={running} onClick={() => patch({ compact: !(data.compact ?? true) })}>{t("module:trename.compact")}</SegmentButton>
          <SegmentButton active={data.dryRun ?? true} disabled={running} onClick={() => patch({ dryRun: !(data.dryRun ?? true) })}>{t("module:trename.dryRun")}</SegmentButton>
          <ActionButton disabled={running || !jsonText} onClick={() => execute("import")}><FilePenLine size={14} /> {t("module:trename.count")}</ActionButton>
          <ActionButton disabled={running} onClick={() => execute("undo")}><Undo2 size={14} /> {t("module:trename.undo")}</ActionButton>
          <IconButton title={t("module:trename.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:trename.statTotal")} value={result?.totalItems ?? summary.total} tone="accent" />
          <StatPill label={t("module:trename.statPending")} value={result?.pendingCount ?? summary.pending} />
          <StatPill label={t("module:trename.statReady")} value={result?.readyCount ?? summary.ready} tone="good" />
          <StatPill label={t("module:trename.statOk")} value={result?.successCount ?? 0} />
          <StatPill label={t("module:trename.statConflicts")} value={result?.conflicts.length ?? 0} tone={(result?.conflicts.length ?? 0) ? "bad" : "neutral"} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label={t("module:trename.renameJson")}
            value={jsonText}
            disabled={running}
            spellCheck={false}
            onChange={(event) => patch({ jsonText: event.currentTarget.value })}
          />
          <ResultView className="shrink-0 text-muted-foreground">
            {running ? (
              <div>{t("module:trename.progressLine", { progress: data.progress ?? 0, text: data.progressText ?? "" })}</div>
            ) : result?.conflicts.length ? (
              result.conflicts.slice(0, 20).map((item) => <div key={`${item.type}:${item.srcPath}:${item.tgtPath}`} className="truncate">{item.type} / {item.message}</div>)
            ) : result?.operations.length ? (
              result.operations.slice(0, 20).map((item) => <div key={`${item.originalPath}:${item.newPath}`} className="truncate">{item.originalPath} -&gt; {item.newPath}</div>)
            ) : summary.lines.length ? (
              summary.lines.slice(0, 20).map((line) => <div key={line} className="truncate">{line}</div>)
            ) : (
              <div className="flex items-center justify-center text-muted-foreground"><FolderOpen size={16} className="mr-1" /> {t("module:trename.readyToScan")}</div>
            )}
          </ResultView>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function buildInput(action: TrenameAction, data: TrenameCardState, jsonText: string): TrenameInput {
  return {
    action,
    paths: data.pathText,
    includeHidden: data.includeHidden ?? false,
    includeRoot: data.includeRoot ?? true,
    excludeExts: data.excludeExts,
    excludePatterns: data.excludePatterns,
    maxLines: data.maxLines ?? 1000,
    compact: data.compact ?? true,
    jsonContent: jsonText,
    basePath: data.basePath,
    dryRun: data.dryRun ?? true,
    batchId: data.batchId,
    undoPath: data.undoPath,
  }
}

function summarizeJson(jsonText: string): { total: number; pending: number; ready: number; lines: string[] } {
  try {
    const parsed = JSON.parse(jsonText) as TrenameJson
    const lines: string[] = []
    const counts = { total: 0, pending: 0, ready: 0 }
    for (const node of parsed.root ?? []) walk(node, "", lines, counts)
    return { ...counts, lines }
  } catch {
    return { total: 0, pending: 0, ready: 0, lines: [] }
  }
}

function walk(node: TrenameNode, prefix: string, lines: string[], counts: { total: number; pending: number; ready: number }) {
  counts.total += 1
  if ("src" in node) {
    const tgt = node.tgt ?? ""
    if (!tgt) counts.pending += 1
    else if (tgt !== node.src) counts.ready += 1
    lines.push(`${prefix}${node.src}${tgt ? ` -> ${tgt}` : ""}`)
    return
  }
  const tgt = node.tgt_dir ?? ""
  if (!tgt) counts.pending += 1
  else if (tgt !== node.src_dir) counts.ready += 1
  lines.push(`${prefix}${node.src_dir}/${tgt ? ` -> ${tgt}/` : ""}`)
  for (const child of node.children ?? []) walk(child, `${prefix}  `, lines, counts)
}
