import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderOpen, Minus, Plus, RefreshCw, RotateCcw, Search, Video } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeConfigButton, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { FormatvData, FormatvInput, FormatvResult } from "./core.js"

interface FormatvCardState {
  pathText?: string
  prefixName?: string
  recursive?: boolean
  dryRun?: boolean
  result?: FormatvData | null
  logs?: string[]
  phase?: string
}

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof FormatvCardState)[] = ["pathText", "prefixName", "recursive", "dryRun"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<FormatvCardState>(compId) ?? {}
  const dataRef = useRef<FormatvCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.formatv] 读取）
  const [defaults, setDefaults] = useState<Partial<FormatvCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<FormatvCardState>>().then((result) => {
      setDefaults(result.config)
    }).catch(() => {
      // backend 不可用或配置文件不存在
    })
  }, [])

  // 检测 comp.data 中的配置字段是否与 TOML 默认值不同
  useEffect(() => {
    if (!defaults) return
    const dirty = CONFIG_FIELDS.some((field) => {
      const current = data[field] as string | undefined
      const defaultVal = defaults[field] as string | undefined
      return (current ?? "") !== (defaultVal ?? "")
    })
    setConfigDirty(dirty)
  }, [data.pathText, data.prefixName, data.recursive, data.dryRun, defaults])

  const logs = data.logs ?? []
  const paths = splitLines(data.pathText)
  const prefixName = data.prefixName || "hb"
  const recursive = data.recursive ?? false
  const dryRun = data.dryRun ?? false
  const result = data.result
  const phase = data.phase ?? "idle"

  function phaseLabelFor(p: string): string {
    return p === "idle" ? t("module:formatv.phaseIdle")
      : p === "completed" ? t("module:formatv.phaseCompleted")
      : p === "error" ? t("module:formatv.phaseError")
      : p === "scan" ? t("module:formatv.phaseScan")
      : p === "add_nov" ? t("module:formatv.phaseAddNov")
      : p === "remove_nov" ? t("module:formatv.phaseRemoveNov")
      : p === "check_duplicates" ? t("module:formatv.phaseCheckDuplicates")
      : p
  }

  function patch(patchData: Partial<FormatvCardState>) {
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

  async function execute(action: FormatvInput["action"]) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")
    setRunning(true)
    try {
      patch({ phase: action })
      const response = await runNativeAction<FormatvInput, FormatvData>("formatv", {
        action,
        paths,
        recursive,
        prefixName,
        dryRun,
      }, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as FormatvResult
      patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  async function copyResults() {
    const text = [
      ...(result?.duplicates ?? []),
      ...(result?.operations ?? []).map((item) => `${item.status} ${item.sourcePath} -> ${item.targetPath}`),
      ...(result?.normalFiles ?? []),
      ...(result?.novFiles ?? []),
    ].join("\n")
    await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function saveAsDefault() {
    const config: Partial<FormatvCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field] as string | undefined
      if (value) (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    patch({ pathText: undefined, prefixName: undefined, recursive: undefined, dryRun: undefined })
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:formatv.title")}
        meta={t("module:formatv.meta", { phase: phaseLabelFor(phase), count: paths.length || 0, mode: dryRun ? t("module:formatv.dryRun") : t("module:formatv.write") })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <ActionButton disabled={running || !paths.length} onClick={() => execute("scan")}><RefreshCw size={14} /> {t("module:formatv.scan")}</ActionButton>
            <ActionButton disabled={running || !paths.length} onClick={() => execute("add_nov")}><Plus size={14} /> .nov</ActionButton>
            <ActionButton disabled={running || !paths.length} onClick={() => execute("remove_nov")}><Minus size={14} /> .nov</ActionButton>
            <ActionButton disabled={running || !paths.length} onClick={() => execute("check_duplicates")}><Search size={14} /> {t("module:formatv.dup")}</ActionButton>
            <IconButton title={t("module:formatv.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:formatv.copyLogs")} onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title={t("module:formatv.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:formatv.fieldPaths")} value={data.pathText ?? ""} disabled={running} onChange={(event) => patch({ pathText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:formatv.pastePaths")} disabled={running} onClick={pastePath}><FolderOpen size={13} /></IconButton>
          <Field label={t("module:formatv.fieldPrefix")} value={prefixName} disabled={running} onChange={(event) => patch({ prefixName: event.currentTarget.value })} className="min-w-0 flex-1" />
          <SegmentButton active={recursive} disabled={running} onClick={() => patch({ recursive: !recursive })}>{t("module:formatv.recursive")}</SegmentButton>
          <SegmentButton active={dryRun} disabled={running} onClick={() => patch({ dryRun: !dryRun })}>{t("module:formatv.dryRun")}</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:formatv.statNormal")} value={result?.normalCount ?? 0} tone="good" />
          <StatPill label=".nov" value={result?.novCount ?? 0} tone="accent" />
          <StatPill label={prefixName} value={result?.prefixedCounts[prefixName] ?? 0} tone="accent" />
          <StatPill label={t("module:formatv.statSuccess")} value={result?.successCount ?? 0} tone="good" />
          <StatPill label={t("module:formatv.statDups")} value={result?.duplicateCount ?? 0} tone={(result?.duplicateCount ?? 0) ? "bad" : "neutral"} />
          <StatPill label={t("module:formatv.statErrors")} value={result?.errorCount ?? 0} tone={(result?.errorCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {result?.operations.length ? result.operations.slice(0, 80).map((item) => (
            <div key={`${item.sourcePath}:${item.targetPath}`} className={item.status === "error" ? "mb-1 truncate text-red-500" : "mb-1 truncate"}>
              {item.status} {item.sourcePath} -&gt; {item.targetPath}{item.reason ? ` / ${item.reason}` : ""}
            </div>
          )) : result?.duplicates.length ? result.duplicates.slice(0, 80).map((item) => (
            <div key={item} className="mb-1 truncate text-red-500">{item}</div>
          )) : result ? (
            <FileList result={result} prefixName={prefixName} />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground"><Video size={14} className="mr-2" />{t("module:formatv.noScanYet")}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function FileList({ result, prefixName }: { result: FormatvData; prefixName: string }) {
  const { t } = useTranslation()
  const files = [
    ...result.normalFiles.map((file) => `normal ${file}`),
    ...result.novFiles.map((file) => `.nov ${file}`),
    ...(result.prefixedFiles[prefixName] ?? []).map((file) => `${prefixName} ${file}`),
  ]
  return files.length ? files.slice(0, 100).map((line) => <div key={line} className="mb-1 truncate">{line}</div>) : t("module:formatv.noVideoFiles")
}

function splitLines(text?: string): string[] {
  return (text ?? "").split(/\r?\n|[;]/).map((item) => item.trim()).filter(Boolean)
}
