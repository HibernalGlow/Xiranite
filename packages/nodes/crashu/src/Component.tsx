import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderOpen, MoveRight, RotateCcw, Search, Zap } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeConfigButton, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { CrashuData, CrashuInput, CrashuResult } from "./core.js"

interface CrashuCardState {
  sourcePathsText?: string
  targetPath?: string
  targetNamesText?: string
  destinationPath?: string
  similarityThreshold?: number
  autoMove?: boolean
  moveDirection?: "to_target" | "to_source"
  conflictPolicy?: "skip" | "overwrite" | "rename"
  result?: CrashuData | null
  logs?: string[]
  phase?: string
}

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof CrashuCardState)[] = ["sourcePathsText", "targetPath", "targetNamesText", "destinationPath", "similarityThreshold", "autoMove", "moveDirection", "conflictPolicy"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<CrashuCardState>(compId) ?? {}
  const dataRef = useRef<CrashuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.crashu] 读取）
  const [defaults, setDefaults] = useState<Partial<CrashuCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<CrashuCardState>>().then((result) => {
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
  }, [data.sourcePathsText, data.targetPath, data.targetNamesText, data.destinationPath, data.similarityThreshold, data.autoMove, data.moveDirection, data.conflictPolicy, defaults])

  const logs = data.logs ?? []
  const sourcePaths = splitLines(data.sourcePathsText)
  const targetNames = splitLines(data.targetNamesText)
  const threshold = data.similarityThreshold ?? 0.6
  const autoMove = data.autoMove ?? false
  const direction = data.moveDirection ?? "to_target"
  const conflict = data.conflictPolicy ?? "skip"
  const plan = data.result?.plan ?? []
  const matches = data.result?.similarFolders ?? []

  function patch(patchData: Partial<CrashuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function paste(field: "sourcePathsText" | "targetPath" | "targetNamesText" | "destinationPath") {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    patch({ [field]: field.endsWith("Text") ? text.trim() : text.trim() })
  }

  async function execute(action: CrashuInput["action"]) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")
    setRunning(true)
    patch({ phase: action === "move" || action === "execute" ? "moving" : action })
    try {
      const response = await runNativeAction<CrashuInput, CrashuData>("crashu", {
        action,
        sourcePaths,
        targetPath: data.targetPath,
        targetNames,
        destinationPath: data.destinationPath,
        similarityThreshold: threshold,
        autoMove: action === "move" || action === "execute" ? true : autoMove,
        moveDirection: direction,
        conflictPolicy: conflict,
      }, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as CrashuResult
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

  async function copyResults() {
    const text = matches.map((item) => `${item.path} -> ${item.target} (${Math.round(item.similarity * 100)}%)`).join("\n")
    await host.clipboard?.writeText?.(text)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function saveAsDefault() {
    const config: Partial<CrashuCardState> = {}
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
    patch({ sourcePathsText: undefined, targetPath: undefined, targetNamesText: undefined, destinationPath: undefined, similarityThreshold: undefined, autoMove: undefined, moveDirection: undefined, conflictPolicy: undefined })
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:crashu.title")}
        meta={t("module:crashu.meta", {
          phase: t(`module:crashu.phases.${data.phase ?? "idle"}`),
          matches: matches.length,
        })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <ActionButton disabled={running || !sourcePaths.length} onClick={() => execute("scan")}><Search size={14} /> {t("module:crashu.scan")}</ActionButton>
            <ActionButton disabled={running || !sourcePaths.length} onClick={() => execute("plan")}><Zap size={14} /> {t("module:crashu.plan")}</ActionButton>
            <ActionButton variant="primary" disabled={running || !sourcePaths.length || !data.destinationPath} onClick={() => execute("move")}><MoveRight size={14} /> {t("module:crashu.move")}</ActionButton>
            <IconButton title={t("module:crashu.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:crashu.copyLogs")} onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title={t("module:crashu.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea label={t("module:crashu.sources")} value={data.sourcePathsText ?? ""} disabled={running} onChange={(event) => patch({ sourcePathsText: event.currentTarget.value })} placeholder={t("module:crashu.placeholderSources")} />
          <TextArea label={t("module:crashu.targets")} value={data.targetNamesText ?? ""} disabled={running || Boolean(data.targetPath?.trim())} onChange={(event) => patch({ targetNamesText: event.currentTarget.value })} placeholder={t("module:crashu.placeholderTargets")} />
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:crashu.targetFolder")} value={data.targetPath ?? ""} disabled={running} onChange={(event) => patch({ targetPath: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:crashu.pasteTargetFolder")} disabled={running} onClick={() => paste("targetPath")}><FolderOpen size={13} /></IconButton>
          <Field label={t("module:crashu.destination")} value={data.destinationPath ?? ""} disabled={running} onChange={(event) => patch({ destinationPath: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:crashu.pasteDestination")} disabled={running} onClick={() => paste("destinationPath")}><FolderOpen size={13} /></IconButton>
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:crashu.threshold")} type="number" min={0} max={1} step={0.05} value={threshold} disabled={running} onChange={(event) => patch({ similarityThreshold: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <SegmentButton active={autoMove} disabled={running} onClick={() => patch({ autoMove: !autoMove })}>{t("module:crashu.autoMove")}</SegmentButton>
          <SegmentButton active={direction === "to_target"} disabled={running} onClick={() => patch({ moveDirection: "to_target" })}>{t("module:crashu.toTarget")}</SegmentButton>
          <SegmentButton active={direction === "to_source"} disabled={running} onClick={() => patch({ moveDirection: "to_source" })}>{t("module:crashu.toSource")}</SegmentButton>
          <SegmentButton active={conflict === "skip"} disabled={running} onClick={() => patch({ conflictPolicy: "skip" })}>{t("module:crashu.skip")}</SegmentButton>
          <SegmentButton active={conflict === "rename"} disabled={running} onClick={() => patch({ conflictPolicy: "rename" })}>{t("module:crashu.rename")}</SegmentButton>
          <SegmentButton active={conflict === "overwrite"} disabled={running} onClick={() => patch({ conflictPolicy: "overwrite" })}>{t("module:crashu.overwrite")}</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:crashu.sources")} value={data.result?.sourceCount ?? sourcePaths.length} tone="accent" />
          <StatPill label={t("module:crashu.targets")} value={data.result?.targetCount ?? targetNames.length} tone="accent" />
          <StatPill label={t("module:crashu.matches")} value={data.result?.similarFound ?? 0} tone="good" />
          <StatPill label={t("module:crashu.moved")} value={data.result?.movedCount ?? 0} tone="good" />
          <StatPill label={t("module:crashu.skipped")} value={data.result?.skippedCount ?? 0} />
          <StatPill label={t("module:crashu.errors")} value={data.result?.errorCount ?? 0} tone={(data.result?.errorCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {plan.length ? plan.slice(0, 80).map((item) => (
            <div key={`${item.sourcePath}:${item.destinationPath}`} className={item.status === "error" ? "mb-1 truncate text-red-500" : "mb-1 truncate"}>
              {item.status} {Math.round(item.similarity * 100)}% {item.sourcePath}{item.destinationPath ? ` -> ${item.destinationPath}` : ` / ${item.reason}`}
            </div>
          )) : matches.length ? matches.slice(0, 80).map((item) => (
            <div key={`${item.path}:${item.target}`} className="mb-1 truncate">
              {Math.round(item.similarity * 100)}% {item.name}{" -> "}{item.target}
            </div>
          )) : t("module:crashu.noMatches")}
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
