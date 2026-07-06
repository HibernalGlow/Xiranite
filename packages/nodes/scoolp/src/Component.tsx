import { useState } from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderSearch, Package, Play, RotateCcw, Trash2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { ScoolpAction, ScoolpData, ScoolpInput, ScoolpResult } from "./core.js"
import { formatSize, parseScoolpSyncConfig, planScoolpSyncCommands } from "./core.js"

interface ScoolpCardState {
  action?: ScoolpAction
  path?: string
  configText?: string
  packageName?: string
  packages?: string
  result?: ScoolpData | null
  logs?: string[]
  phase?: string
  dryRun?: boolean
}

const actionIds: ScoolpAction[] = ["status", "list_packages", "sync", "cache_list"]

const actionLabelKey: Record<ScoolpAction, string> = {
  status: "module:scoolp.actionStatus",
  init: "module:scoolp.actionStatus",
  list_packages: "module:scoolp.actionList",
  package_info: "module:scoolp.actionList",
  install: "module:scoolp.actionList",
  show_config: "module:scoolp.actionStatus",
  sync: "module:scoolp.actionSync",
  cache_list: "module:scoolp.actionCache",
  cache_backup: "module:scoolp.actionCache",
  cache_delete: "module:scoolp.actionCache",
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<ScoolpCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const result = data.result ?? null
  const action = data.action ?? "status"
  const dryRun = data.dryRun ?? true

  function patch(patchData: Partial<ScoolpCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pasteConfig() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ configText: text })
  }

  async function execute(nextAction = action) {
    if (running) return

    if ((nextAction === "sync" || nextAction === "show_config") && data.configText?.trim()) {
      try {
        const syncConfig = parseScoolpSyncConfig(data.configText)
        const syncPlan = planScoolpSyncCommands(syncConfig, true)
        patch({
          phase: "completed",
          action: nextAction,
          result: { scoopInstalled: false, installedPackages: [], buckets: [], availablePackages: [], syncPlan, commandResults: [], syncConfig, installedCount: 0, failedCount: 0, cleanedCount: 0, cleanedSizeBytes: 0, errors: [] },
        })
        log(`sync dry-run: ${syncPlan.length} command(s)`)
      } catch (error) {
        log(error instanceof Error ? error.message : String(error))
      }
      return
    }

    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Paste sync TOML for local dry-run or use the package CLI for system actions.")

    setRunning(true)
    patch({ phase: "running", action: nextAction })
    const input: ScoolpInput = {
      action: nextAction,
      path: data.path,
      configText: data.configText,
      packageName: data.packageName,
      packages: splitPackages(data.packages),
      dryRun,
    }
    const response = await runNativeAction<ScoolpInput, ScoolpData>("scoolp", input, (event) => {
      if (event.type === "log") log(event.message)
    }) as ScoolpResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  function reset() {
    patch({ phase: "idle", result: null, logs: [] })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:scoolp.title")}
        meta={t("module:scoolp.meta", {
          phase: data.phase ?? t("module:scoolp.idle"),
          action: t(actionLabelKey[action]),
          mode: dryRun ? t("module:scoolp.dryRun") : t("module:scoolp.execute"),
        })}
        actions={
          <>
            <IconButton title={t("module:scoolp.pasteConfig")} onClick={pasteConfig}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={running} onClick={() => execute()}><Play size={14} /> {t("module:scoolp.run")}</ActionButton>
            <IconButton title={t("module:scoolp.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title={t("module:scoolp.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          {actionIds.map((id) => (
            <SegmentButton key={id} active={action === id} disabled={running} onClick={() => patch({ action: id })}>{t(actionLabelKey[id])}</SegmentButton>
          ))}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:scoolp.path")} value={data.path ?? ""} disabled={running} onChange={(event) => patch({ path: event.currentTarget.value })} />
          <Field label={t("module:scoolp.package")} value={data.packageName ?? ""} disabled={running} onChange={(event) => patch({ packageName: event.currentTarget.value })} />
          <SegmentButton active={dryRun} disabled={running} onClick={() => patch({ dryRun: !dryRun })}>{dryRun ? t("module:scoolp.dryRun") : t("module:scoolp.execute")}</SegmentButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label={t("module:scoolp.syncToml")}
            value={action === "install" ? data.packages ?? "" : data.configText ?? ""}
            disabled={running}
            onChange={(event) => action === "install" ? patch({ packages: event.currentTarget.value }) : patch({ configText: event.currentTarget.value })}
            placeholder={t("module:scoolp.syncTomlPlaceholder")}
          />
          <ResultView className="text-muted-foreground">
            <Result result={result} t={t} />
          </ResultView>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:scoolp.statPackages")} value={result?.installedPackages.length || result?.availablePackages.length || 0} tone="accent" />
          <StatPill label={t("module:scoolp.statBuckets")} value={result?.buckets.length ?? result?.syncConfig?.buckets.length ?? 0} />
          <StatPill label={t("module:scoolp.statCache")} value={result?.cache?.obsoleteCount ?? 0} />
          <StatPill label={t("module:scoolp.statFailed")} value={result?.failedCount ?? 0} tone={result?.failedCount ? "bad" : "neutral"} />
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function Result({ result, t }: { result: ScoolpData | null; t: TFunction }) {
  if (!result) return <div className="flex h-full items-center justify-center">{t("module:scoolp.noResult")}</div>
  if (result.syncPlan.length) {
    return result.syncPlan.slice(0, 80).map((item) => (
      <div key={`${item.label}:${item.args.join(" ")}`} className="mb-1">
        <div className="truncate text-primary"><FolderSearch size={11} className="mr-1 inline" />{item.label}</div>
        <div className="truncate">{item.command} {item.args.join(" ")}</div>
      </div>
    ))
  }
  if (result.availablePackages.length) {
    return result.availablePackages.slice(0, 80).map((item) => (
      <div key={item.name} className="mb-1">
        <div className="truncate text-primary"><Package size={11} className="mr-1 inline" />{item.name} {item.version ?? ""}</div>
        <div className="truncate">{item.description ?? item.homepage ?? ""}</div>
      </div>
    ))
  }
  if (result.cache) {
    return (
      <div>
        <div className="mb-2 text-primary"><Trash2 size={11} className="mr-1 inline" />{result.cache.obsoleteCount} {t("module:scoolp.obsolete")} / {formatSize(result.cache.obsoleteSize)}</div>
        {result.cache.obsoletePackages.slice(0, 80).map((item) => (
          <div key={item.path} className="truncate">{item.name} {item.version} / {formatSize(item.size)}</div>
        ))}
      </div>
    )
  }
  return <div className="flex h-full items-center justify-center">{t("module:scoolp.scoopInstalled", { installed: String(result.scoopInstalled) })}</div>
}

function splitPackages(value?: string): string[] {
  return (value ?? "").split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)
}
