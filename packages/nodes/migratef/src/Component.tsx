import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderSync, History, MoveRight, Play, RotateCcw } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, NodeConfigButton, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { MigratefData, MigratefInput, MigratefMode, MigratefResult } from "./core.js"

interface MigratefCardState {
  sourceText?: string
  targetPath?: string
  historyPath?: string
  mode?: MigratefMode
  result?: MigratefData | null
  logs?: string[]
  phase?: string
}

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof MigratefCardState)[] = ["sourceText", "targetPath", "historyPath", "mode"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<MigratefCardState>(compId) ?? {}
  const dataRef = useRef<MigratefCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.migratef] 读取）
  const [defaults, setDefaults] = useState<Partial<MigratefCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<MigratefCardState>>().then((result) => {
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
  }, [data.sourceText, data.targetPath, data.historyPath, data.mode, defaults])

  const logs = data.logs ?? []
  const plan = data.result?.plan ?? []
  const history = data.result?.history ?? []
  const mode = data.mode ?? "preserve"

  function patch(patchData: Partial<MigratefCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function paste(field: "sourceText" | "targetPath" | "historyPath") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  async function execute(action: MigratefInput["action"], dryRun = false) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")
    setRunning(true)
    patch({ phase: "running" })
    try {
      const response = await runNativeAction<MigratefInput, MigratefData>("migratef", {
        action,
        mode,
        sourcePaths: splitLines(data.sourceText),
        targetPath: data.targetPath,
        historyPath: data.historyPath,
        dryRun,
      }, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as MigratefResult
      patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
      log(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error" })
      log(message)
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function saveAsDefault() {
    const config: Partial<MigratefCardState> = {}
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
    patch({ sourceText: undefined, targetPath: undefined, historyPath: undefined, mode: undefined })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:migratef.title")}
        meta={t("module:migratef.meta", { phase: data.phase ?? "idle", mode: t(`module:migratef.${mode}Mode`) })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <ActionButton disabled={running} onClick={() => execute("plan", true)}><Play size={14} /> {t("module:migratef.plan")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("move")}><MoveRight size={14} /> {t("module:migratef.move")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("copy")}><Copy size={14} /> {t("module:migratef.copy")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("history")}><History size={14} /> {t("module:migratef.history")}</ActionButton>
            <IconButton title={t("module:migratef.copyLogs")} onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title={t("module:migratef.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:migratef.targetLabel")} value={data.targetPath ?? ""} disabled={running} onChange={(event) => patch({ targetPath: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:migratef.pasteTarget")} onClick={() => paste("targetPath")} disabled={running}><FolderSync size={13} /></IconButton>
          <Field label={t("module:migratef.historyLabel")} value={data.historyPath ?? ""} disabled={running} onChange={(event) => patch({ historyPath: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:migratef.pasteHistory")} onClick={() => paste("historyPath")} disabled={running}><FolderSync size={13} /></IconButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          {(["preserve", "flat", "direct"] as const).map((item) => (
            <SegmentButton key={item} active={mode === item} disabled={running} onClick={() => patch({ mode: item })}>{t(`module:migratef.${item}Mode`)}</SegmentButton>
          ))}
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <TextArea label={t("module:migratef.sourcesLabel")} value={data.sourceText ?? ""} disabled={running} onChange={(event) => patch({ sourceText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1">
              <StatPill label={t("module:migratef.migratedLabel")} value={data.result?.migratedCount ?? 0} tone="good" />
              <StatPill label={t("module:migratef.skippedLabel")} value={data.result?.skippedCount ?? 0} />
              <StatPill label={t("module:migratef.errorsLabel")} value={data.result?.errorCount ?? data.result?.failedCount ?? 0} tone={(data.result?.errorCount || data.result?.failedCount) ? "bad" : "neutral"} />
              <StatPill label={t("module:migratef.batchLabel")} value={data.result?.operationId || "-"} tone="accent" />
            </div>
            <ResultView className="flex-1 text-muted-foreground">
              {plan.length ? plan.slice(0, 40).map((item) => (
                <div key={`${item.sourcePath}:${item.targetPath}`} className="mb-1 truncate">
                  {item.status} {item.sourcePath} -&gt; {item.targetPath || item.reason}
                </div>
              )) : history.length ? history.slice(0, 20).map((item) => (
                <div key={item.id} className="mb-1 truncate">
                  {t("module:migratef.historyItem", { id: item.id, action: item.action, count: item.operations.length })} {item.undone ? t("module:migratef.undoneLabel") : ""}
                </div>
              )) : t("module:migratef.noResult")}
            </ResultView>
          </div>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function splitLines(value?: string): string[] {
  return (value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}
