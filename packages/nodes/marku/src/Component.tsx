import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FileCode, History, Play, RotateCcw, Undo2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, NodeConfigButton, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { MarkuData, MarkuInput, MarkuModuleId, MarkuResult } from "./core.js"
import { MARKU_MODULES } from "./core.js"

interface MarkuCardState {
  inputText?: string
  pathText?: string
  module?: string
  configText?: string
  recursive?: boolean
  dryRun?: boolean
  enableUndo?: boolean
  result?: MarkuData | null
  logs?: string[]
  phase?: string
}

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof MarkuCardState)[] = ["inputText", "pathText", "module", "configText", "recursive", "dryRun", "enableUndo"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<MarkuCardState>(compId) ?? {}
  const dataRef = useRef<MarkuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.marku] 读取）
  const [defaults, setDefaults] = useState<Partial<MarkuCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<MarkuCardState>>().then((result) => {
      setDefaults(result.config)
    }).catch(() => {
      // backend 不可用或配置文件不存在
    })
  }, [])

  // 检测 comp.data 中的配置字段是否与 TOML 默认值不同
  useEffect(() => {
    if (!defaults) return
    const dirty = CONFIG_FIELDS.some((field) => {
      const current = data[field] as string | boolean | undefined
      const defaultVal = defaults[field] as string | boolean | undefined
      return (current ?? "") !== (defaultVal ?? "")
    })
    setConfigDirty(dirty)
  }, [data.inputText, data.pathText, data.module, data.configText, data.recursive, data.dryRun, data.enableUndo, defaults])

  const logs = data.logs ?? []
  const selectedModule = data.module ?? "markt"
  const dryRun = data.dryRun ?? true
  const recursive = data.recursive ?? false
  const enableUndo = data.enableUndo ?? true
  const paths = splitLines(data.pathText)
  const hasText = Boolean(data.inputText?.trim())
  const result = data.result

  function patch(patchData: Partial<MarkuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-50), message] })
  }

  async function pasteText() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ inputText: text })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text.trim() })
  }

  async function execute(action: MarkuInput["action"] = "run") {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for Markdown actions.")
    setRunning(true)
    patch({ phase: action })
    try {
      const response = await runNativeAction<MarkuInput, MarkuData>("marku", {
        action,
        module: selectedModule,
        inputText: hasText ? data.inputText : "",
        paths: hasText ? [] : paths,
        stepConfig: parseConfig(data.configText),
        recursive,
        dryRun,
        enableUndo,
      }, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as MarkuResult
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

  async function copyOutput() {
    const text = result?.outputText || result?.diffText || result?.diffs.map((item) => item.diff).join("\n") || ""
    await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function saveAsDefault() {
    const config: Partial<MarkuCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field] as string | boolean | undefined
      if (value !== undefined && value !== "") (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    patch({ inputText: undefined, pathText: undefined, module: undefined, configText: undefined, recursive: undefined, dryRun: undefined, enableUndo: undefined })
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:marku.title")}
        meta={t("module:marku.meta", { phase: data.phase ?? "idle", module: selectedModule, mode: dryRun ? t("module:marku.dryRun") : t("module:marku.writeMode") })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <ActionButton disabled={running || (!hasText && !paths.length)} onClick={() => execute(hasText ? "text" : "run")}><Play size={14} /> {t("module:marku.run")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("history")}><History size={14} /> {t("module:marku.history")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("undo")}><Undo2 size={14} /> {t("module:marku.undo")}</ActionButton>
            <IconButton title={t("module:marku.copyOutput")} onClick={copyOutput}><Copy size={14} /></IconButton>
            <IconButton title={t("module:marku.copyLogs")} onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title={t("module:marku.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          {MARKU_MODULES.map((module) => (
            <SegmentButton key={module.id} active={selectedModule === module.id} disabled={running} onClick={() => patch({ module: module.id })}>
              {module.id}
            </SegmentButton>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea label={t("module:marku.textInputLabel")} value={data.inputText ?? ""} disabled={running} onChange={(event) => patch({ inputText: event.currentTarget.value })} placeholder={t("module:marku.textInputPlaceholder")} />
          <TextArea label={t("module:marku.pathsConfigLabel")} value={data.pathText ?? ""} disabled={running || hasText} onChange={(event) => patch({ pathText: event.currentTarget.value })} placeholder={t("module:marku.pathsConfigPlaceholder")} />
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:marku.configJsonLabel")} value={data.configText ?? ""} disabled={running} onChange={(event) => patch({ configText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:marku.pasteText")} disabled={running} onClick={pasteText}><FileCode size={13} /></IconButton>
          <IconButton title={t("module:marku.pastePath")} disabled={running} onClick={pastePath}><Clipboard size={13} /></IconButton>
          <SegmentButton active={recursive} disabled={running || hasText} onClick={() => patch({ recursive: !recursive })}>{t("module:marku.recursive")}</SegmentButton>
          <SegmentButton active={dryRun} disabled={running || hasText} onClick={() => patch({ dryRun: !dryRun })}>{t("module:marku.dryRun")}</SegmentButton>
          <SegmentButton active={enableUndo} disabled={running || dryRun || hasText} onClick={() => patch({ enableUndo: !enableUndo })}>{t("module:marku.undoToggle")}</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:marku.processedLabel")} value={result?.filesProcessed ?? 0} tone="accent" />
          <StatPill label={t("module:marku.changed")} value={result?.filesChanged ?? 0} tone="good" />
          <StatPill label={t("module:marku.diffsLabel")} value={result?.diffs.filter((item) => item.changed).length ?? 0} />
          <StatPill label={t("module:marku.history")} value={result?.history.length ?? 0} />
          <StatPill label={t("module:marku.errorsLabel")} value={result?.errors.length ?? 0} tone={(result?.errors.length ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {result?.outputText ? (
            <pre className="whitespace-pre-wrap break-words">{result.outputText}</pre>
          ) : result?.diffText ? (
            <pre className="whitespace-pre-wrap break-words">{result.diffText}</pre>
          ) : result?.diffs.length ? result.diffs.slice(0, 20).map((item) => (
            <div key={item.file} className="mb-2">
              <div className={item.changed ? "truncate text-primary" : "truncate"}>{item.changed ? t("module:marku.changed") : t("module:marku.same")} {item.file}</div>
              {item.diff ? <pre className="max-h-24 overflow-hidden whitespace-pre-wrap break-words opacity-80">{item.diff}</pre> : null}
            </div>
          )) : result?.history.length ? result.history.map((item) => (
            <div key={item.id} className="mb-1 truncate">{t("module:marku.historyItem", { id: item.id, module: item.module, count: item.files.length })} {item.undone ? t("module:marku.undoneLabel") : ""}</div>
          )) : t("module:marku.noResult")}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function splitLines(text?: string): string[] {
  return (text ?? "").split(/\r?\n|[;]/).map((item) => item.trim()).filter(Boolean)
}

function parseConfig(text?: string): Record<string, unknown> {
  if (!text?.trim()) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
