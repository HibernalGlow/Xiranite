import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Link, List, MoveRight, Play, RotateCcw } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, NodeConfigButton, ResultView, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { LinkRecord, LinkuData, LinkuInput, LinkuResult } from "./core.js"

interface LinkuCardState {
  path?: string
  target?: string
  configPath?: string
  action?: LinkuInput["action"]
  result?: LinkuData | null
  logs?: string[]
  phase?: string
}

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof LinkuCardState)[] = ["path", "target", "configPath"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<LinkuCardState>(compId) ?? {}
  const dataRef = useRef<LinkuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.linku] 读取）
  const [defaults, setDefaults] = useState<Partial<LinkuCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<LinkuCardState>>().then((result) => {
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
  }, [data.path, data.target, data.configPath, defaults])

  const logs = data.logs ?? []
  const links = data.result?.links ?? []

  function patch(patchData: Partial<LinkuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function paste(field: "path" | "target" | "configPath") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  async function execute(action: LinkuInput["action"]) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for symlink actions.")
    setRunning(true)
    try {
      patch({ phase: "running", action })
      const response = await runNativeAction<LinkuInput, LinkuData>("linku", {
        action,
        path: data.path,
        target: data.target,
        configPath: data.configPath,
      }, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as LinkuResult
      patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    patch({ phase: "idle", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<LinkuCardState> = {}
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
    patch({ path: undefined, target: undefined, configPath: undefined })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:linku.title")}
        meta={t("module:linku.meta", { phase: data.phase ?? "idle", count: links.length })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <ActionButton disabled={running} onClick={() => execute("info")}><Play size={14} /> {t("module:linku.info")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("create")}><Link size={14} /> {t("module:linku.create")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("move_link")}><MoveRight size={14} /> {t("module:linku.move")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("list")}><List size={14} /> {t("module:linku.list")}</ActionButton>
            <IconButton title={t("module:linku.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title={t("module:linku.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <PathField label={t("module:linku.sourceLabel")} value={data.path ?? ""} disabled={running} onChange={(value) => patch({ path: value })} onPaste={() => paste("path")} />
          <PathField label={t("module:linku.targetLinkLabel")} value={data.target ?? ""} disabled={running} onChange={(value) => patch({ target: value })} onPaste={() => paste("target")} />
          <PathField label={t("module:linku.configLabel")} value={data.configPath ?? ""} disabled={running} onChange={(value) => patch({ configPath: value })} onPaste={() => paste("configPath")} />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex shrink-0 flex-wrap gap-1">
            <StatPill label={t("module:linku.createdLabel")} value={String(data.result?.created ?? false)} tone={data.result?.created ? "good" : "neutral"} />
            <StatPill label={t("module:linku.recoveredLabel")} value={data.result?.recoveredCount ?? 0} />
            <StatPill label={t("module:linku.failedLabel")} value={data.result?.failedCount ?? 0} tone={data.result?.failedCount ? "bad" : "neutral"} />
            <ActionButton disabled={running} onClick={() => execute("recover")}>{t("module:linku.recover")}</ActionButton>
          </div>
          <ResultView className="flex-1 text-muted-foreground">
            {data.result?.pathInfo ? <PathInfo info={data.result.pathInfo} /> : null}
            {links.length ? links.slice(0, 40).map((record) => <LinkRow key={record.link} record={record} />) : null}
            {!data.result ? t("module:linku.noResult") : null}
          </ResultView>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function PathField(props: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; onPaste: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 gap-1">
      <Field label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} className="min-w-0 flex-1" />
      <IconButton title={t("module:linku.pasteField", { field: props.label })} onClick={props.onPaste} disabled={props.disabled}><Clipboard size={13} /></IconButton>
    </div>
  )
}

function PathInfo({ info }: { info: NonNullable<LinkuData["pathInfo"]> }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-1">
      <div className="truncate">{info.path}</div>
      <div>{t("module:linku.existsLabel")}: {String(info.exists)} / {info.kind}</div>
      <div>{t("module:linku.symlinkLabel")}: {String(info.isSymlink)}</div>
      {info.linkTarget ? <div className="truncate">-&gt; {info.linkTarget}</div> : null}
      {typeof info.sizeMb === "number" ? <div>{info.sizeMb.toFixed(2)} MB</div> : null}
    </div>
  )
}

function LinkRow({ record }: { record: LinkRecord }) {
  return (
    <div className="mb-1">
      <div className="truncate text-primary">{record.link}</div>
      <div className="truncate">-&gt; {record.target}</div>
    </div>
  )
}
