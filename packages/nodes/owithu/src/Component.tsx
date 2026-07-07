import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Eye, MousePointerClick, RotateCcw, ShieldMinus, ShieldPlus } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, NodeConfigButton, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { OwithuAction, OwithuData, OwithuInput, OwithuResult, RegistryHive } from "./core.js"
import { buildOwithuPlan, parseOwithuConfig } from "./core.js"

interface OwithuCardState {
  path?: string
  configText?: string
  hive?: RegistryHive | ""
  onlyKey?: string
  action?: OwithuAction
  result?: OwithuData | null
  logs?: string[]
  phase?: string
}

const CONFIG_FIELDS: (keyof OwithuCardState)[] = ["configText", "hive", "onlyKey"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<OwithuCardState>(compId) ?? {}
  const dataRef = useRef<OwithuCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<OwithuCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<OwithuCardState>>().then((result) => {
      setDefaults(result.config)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!defaults) return
    const dirty = CONFIG_FIELDS.some((field) => {
      const current = data[field] as string | undefined
      const defaultVal = defaults[field] as string | undefined
      return (current ?? "") !== (defaultVal ?? "")
    })
    setConfigDirty(dirty)
  }, [data.configText, data.hive, data.onlyKey, defaults])

  const logs = data.logs ?? []
  const result = data.result ?? null
  const hive = data.hive ?? ""

  function patch(patchData: Partial<OwithuCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function pasteConfig() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ configText: text })
  }

  async function execute(action: OwithuAction) {
    if (running) return

    if (action === "preview" && data.configText?.trim()) {
      try {
        const config = parseOwithuConfig(data.configText)
        const plan = buildOwithuPlan(config, { action: "register", hive, onlyKey: data.onlyKey })
        patch({
          phase: "completed",
          action,
          result: { vars: config.vars, defaults: config.defaults, entries: config.entries, plan, registeredCount: 0, unregisteredCount: 0, failedCount: 0, errors: [] },
        })
        log(`Found ${config.entries.length} entries and ${plan.length} registry operations.`)
      } catch (error) {
        log(error instanceof Error ? error.message : String(error))
      }
      return
    }

    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Paste TOML to preview locally or use the package CLI for registry changes.")

    setRunning(true)
    try {
      patch({ phase: "running", action })
      const input: OwithuInput = {
        action,
        path: data.path,
        configText: data.configText,
        hive,
        onlyKey: data.onlyKey,
      }
      const response = await runNativeAction<OwithuInput, OwithuData>("owithu", input, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as OwithuResult
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
    const config: Partial<OwithuCardState> = {}
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
    patch({ configText: undefined, hive: undefined, onlyKey: undefined })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:owithu.title")}
        meta={t("module:owithu.meta", { phase: data.phase ?? "idle", entries: result?.entries.length ?? 0, ops: result?.plan.length ?? 0 })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <IconButton title={t("module:owithu.pasteToml")} onClick={pasteConfig}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running} onClick={() => execute("preview")}><Eye size={14} /> {t("module:owithu.preview")}</ActionButton>
            <ActionButton variant="primary" disabled={running} onClick={() => execute("register")}><ShieldPlus size={14} /> {t("module:owithu.register")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("unregister")}><ShieldMinus size={14} /> {t("module:owithu.remove")}</ActionButton>
            <IconButton title={t("module:owithu.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title={t("module:owithu.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:owithu.configPath")} value={data.path ?? ""} disabled={running} onChange={(event) => patch({ path: event.currentTarget.value })} />
          <Field label={t("module:owithu.onlyKey")} value={data.onlyKey ?? ""} disabled={running} onChange={(event) => patch({ onlyKey: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={!hive} disabled={running} onClick={() => patch({ hive: "" })}>{t("module:owithu.config")}</SegmentButton>
          {(["HKCU", "HKCR", "HKLM"] as const).map((item) => (
            <SegmentButton key={item} active={hive === item} disabled={running} onClick={() => patch({ hive: item })}>{item}</SegmentButton>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label={t("module:owithu.toml")}
            value={data.configText ?? ""}
            disabled={running}
            onChange={(event) => patch({ configText: event.currentTarget.value })}
            placeholder={t("module:owithu.placeholderToml")}
          />
          <ResultView className="text-muted-foreground">
            {result?.plan.length ? result.plan.slice(0, 80).map((item) => (
              <div key={`${item.registryPath}:${item.command}`} className="mb-1">
                <div className="truncate text-primary"><MousePointerClick size={11} className="mr-1 inline" />{item.entryKey} / {item.hive} / {item.scope}</div>
                <div className="truncate">{item.command}</div>
              </div>
            )) : <div className="flex h-full items-center justify-center">{t("module:owithu.noRegistryPlan")}</div>}
          </ResultView>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:owithu.entries")} value={result?.entries.length ?? 0} />
          <StatPill label={t("module:owithu.ops")} value={result?.plan.length ?? 0} tone="accent" />
          <StatPill label={t("module:owithu.registered")} value={result?.registeredCount ?? 0} tone="good" />
          <StatPill label={t("module:owithu.failed")} value={result?.failedCount ?? 0} tone={result?.failedCount ? "bad" : "neutral"} />
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}
