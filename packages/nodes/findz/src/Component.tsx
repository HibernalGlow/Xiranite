import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Archive, Clipboard, Copy, FileSearch, FolderOpen, HelpCircle, Layers, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeConfigButton, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
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

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof FindzCardState)[] = ["action", "pathText", "where", "noArchive", "followSymlinks", "withImageMeta", "longFormat", "maxResults", "maxReturnFiles", "groupBy", "refine"]

const ACTIONS: Array<{ value: FindzAction; icon: typeof Search }> = [
  { value: "search", icon: Search },
  { value: "archives_only", icon: Archive },
  { value: "nested", icon: Layers },
]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<FindzCardState>(compId) ?? {}
  const dataRef = useRef<FindzCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.findz] 读取）
  const [defaults, setDefaults] = useState<Partial<FindzCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<FindzCardState>>().then((result) => {
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
  }, [data.action, data.pathText, data.where, data.noArchive, data.followSymlinks, data.withImageMeta, data.longFormat, data.maxResults, data.maxReturnFiles, data.groupBy, data.refine, defaults])

  const action = data.action ?? "search"
  const paths = splitPaths(data.pathText)
  const where = data.where?.trim() || "1"
  const logs = data.logs ?? []
  const result = data.result ?? null

  function actionLabelFor(v: FindzAction): string {
    return v === "search" ? t("module:findz.actionSearch")
      : v === "archives_only" ? t("module:findz.actionArchives")
      : t("module:findz.actionNested")
  }

  function patch(patchData: Partial<FindzCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: text })
  }

  async function execute(nextAction = action) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem search.")

    setRunning(true)
    try {
      patch({ phase: nextAction, progress: 0, progressText: t("module:findz.starting"), result: null })
      const response = await runNativeAction<FindzInput, FindzData>("findz", buildInput(nextAction, data), (event) => {
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
    } finally {
      setRunning(false)
    }
  }

  async function showHelp() {
    log("Filter help is available from the CLI `help-filter` command.")
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

  async function saveAsDefault() {
    const config: Partial<FindzCardState> = {}
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
    patch({ action: undefined, pathText: undefined, where: undefined, noArchive: undefined, followSymlinks: undefined, withImageMeta: undefined, longFormat: undefined, maxResults: undefined, maxReturnFiles: undefined, groupBy: undefined, refine: undefined })
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:findz.title")}
        meta={t("module:findz.meta", { action: actionLabelFor(action), count: paths.length || 1, where })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <IconButton title={t("module:findz.pastePaths")} disabled={running} onClick={pastePaths}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={running} onClick={() => execute()}><Play size={14} /> {t("module:findz.run")}</ActionButton>
            <IconButton title={t("module:findz.filterHelp")} disabled={running} onClick={showHelp}><HelpCircle size={14} /></IconButton>
            <IconButton title={t("module:findz.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:findz.copyLogs")} onClick={copyLogs}><FileSearch size={14} /></IconButton>
            <IconButton title={t("module:findz.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          {ACTIONS.map((item) => {
            const Icon = item.icon
            return (
              <SegmentButton key={item.value} active={action === item.value} disabled={running} onClick={() => patch({ action: item.value })}>
                <Icon size={14} /> {actionLabelFor(item.value)}
              </SegmentButton>
            )
          })}
          <SegmentButton active={data.noArchive ?? false} disabled={running || action !== "search"} onClick={() => patch({ noArchive: !(data.noArchive ?? false) })}>{t("module:findz.noArchive")}</SegmentButton>
          <SegmentButton active={data.followSymlinks ?? false} disabled={running} onClick={() => patch({ followSymlinks: !(data.followSymlinks ?? false) })}>{t("module:findz.links")}</SegmentButton>
          <SegmentButton active={data.withImageMeta ?? false} disabled={running} onClick={() => patch({ withImageMeta: !(data.withImageMeta ?? false) })}>{t("module:findz.imageMeta")}</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:findz.fieldMax")} type="number" value={data.maxResults ?? 0} disabled={running} onChange={(event) => patch({ maxResults: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <Field label={t("module:findz.fieldReturn")} type="number" value={data.maxReturnFiles ?? 5000} disabled={running} onChange={(event) => patch({ maxReturnFiles: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <Field label={t("module:findz.fieldGroup")} value={data.groupBy ?? ""} disabled={running} onChange={(event) => patch({ groupBy: event.currentTarget.value })} placeholder="archive/ext/dir" className="min-w-0 flex-1" />
          <Field label={t("module:findz.fieldRefine")} value={data.refine ?? ""} disabled={running} onChange={(event) => patch({ refine: event.currentTarget.value })} placeholder="count > 10" className="min-w-0 flex-1" />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <TextArea
            label={t("module:findz.pathsLabel")}
            value={data.pathText ?? ""}
            disabled={running}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            placeholder={t("module:findz.pathsPlaceholder")}
          />
          <TextArea
            label={t("module:findz.whereLabel")}
            value={data.where ?? "1"}
            disabled={running}
            onChange={(event) => patch({ where: event.currentTarget.value })}
            placeholder={'ext IN ("jpg", "png") AND archive <> ""'}
          />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:findz.statTotal")} value={result?.totalCount ?? 0} tone="accent" />
          <StatPill label={t("module:findz.statFiles")} value={result?.fileCount ?? 0} tone="good" />
          <StatPill label={t("module:findz.statDirs")} value={result?.dirCount ?? 0} />
          <StatPill label={t("module:findz.statArchive")} value={result?.archiveCount ?? 0} tone="accent" />
          <StatPill label={t("module:findz.statErrors")} value={result?.errors.length ?? 0} tone={(result?.errors.length ?? 0) ? "bad" : "neutral"} />
          <StatPill label={t("module:findz.statProgress")} value={`${data.progress ?? 0}%`} />
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
            <div className="flex h-full items-center justify-center text-muted-foreground"><FolderOpen size={14} className="mr-2" />{data.progressText || t("module:findz.noResult")}</div>
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
