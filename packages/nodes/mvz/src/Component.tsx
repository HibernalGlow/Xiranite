import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FileArchive, FolderOpen, MoveRight, PencilLine, Play, RotateCcw, Trash2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { MvzAction, MvzData, MvzInput, MvzResult } from "./core.js"
import { parseMvzEntries } from "./core.js"

interface MvzCardState {
  action?: MvzAction
  entryText?: string
  output?: string
  pattern?: string
  replacement?: string
  separator?: string
  near?: boolean
  autoDir?: boolean
  flatten?: boolean
  dryRun?: boolean
  result?: MvzData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

const ACTIONS: Array<{ value: MvzAction; labelKey: string; icon: typeof FileArchive }> = [
  { value: "extract", labelKey: "module:mvz.extract", icon: FolderOpen },
  { value: "move", labelKey: "module:mvz.move", icon: MoveRight },
  { value: "delete", labelKey: "module:mvz.delete", icon: Trash2 },
  { value: "rename", labelKey: "module:mvz.rename", icon: PencilLine },
]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<MvzCardState>(compId) ?? {}
  const dataRef = useRef<MvzCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const action = data.action ?? "extract"
  const separator = data.separator || "//"
  const entries = parseMvzEntries(data.entryText ?? "", separator)
  const archives = new Set(entries.map((entry) => entry.archivePath)).size
  const logs = data.logs ?? []
  const result = data.result ?? null
  const dryRun = data.dryRun ?? true

  function patch(patchData: Partial<MvzCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function pasteEntries() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ entryText: text })
  }

  async function execute(nextAction = action) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for archive filesystem actions.")

    setRunning(true)
    try {
      patch({ phase: nextAction, progress: 0, progressText: "starting", result: null })
      const response = await runNativeAction<MvzInput, MvzData>("mvz", buildInput(nextAction, data), (event) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
        else log(event.message)
      }) as MvzResult
  
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

  async function copyResults() {
    const lines = [
      ...(result?.preview ?? []).map((item) => item.command ?? `${item.action} ${item.archive}`),
      ...(result?.results ?? []).map((item) => `${item.success ? "ok" : "fail"} ${item.action} ${item.archive} (${item.count}) ${item.message}`),
    ]
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:mvz.title")}
        meta={t("module:mvz.meta", { action: t(`module:mvz.${action}`), mode: dryRun ? t("module:mvz.dryRun") : t("module:mvz.live"), files: entries.length, archives })}
        actions={
          <>
            <IconButton title={t("module:mvz.pasteFindzEntries")} disabled={running} onClick={pasteEntries}><Clipboard size={14} /></IconButton>
            <ActionButton variant={action === "delete" && !dryRun ? "danger" : "primary"} disabled={running || !canRun(action, entries.length, data)} onClick={() => execute()}><Play size={14} /> {t("module:mvz.run")}</ActionButton>
            <IconButton title={t("module:mvz.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:mvz.copyLogs")} onClick={copyLogs}><FileArchive size={14} /></IconButton>
            <IconButton title={t("module:mvz.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          {ACTIONS.map((item) => {
            const Icon = item.icon
            return (
              <SegmentButton key={item.value} active={action === item.value} disabled={running} onClick={() => patch({ action: item.value })}>
                <Icon size={14} /> {t(item.labelKey)}
              </SegmentButton>
            )
          })}
          <SegmentButton active={dryRun} disabled={running} onClick={() => patch({ dryRun: !dryRun })}>{t("module:mvz.dryRun")}</SegmentButton>
          <SegmentButton active={data.near ?? true} disabled={running || action === "delete" || action === "rename"} onClick={() => patch({ near: !(data.near ?? true) })}>{t("module:mvz.near")}</SegmentButton>
          <SegmentButton active={data.autoDir ?? true} disabled={running || action === "delete" || action === "rename"} onClick={() => patch({ autoDir: !(data.autoDir ?? true) })}>{t("module:mvz.autoDir")}</SegmentButton>
          <SegmentButton active={data.flatten ?? false} disabled={running || action === "delete" || action === "rename"} onClick={() => patch({ flatten: !(data.flatten ?? false) })}>{t("module:mvz.flatten")}</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:mvz.outputLabel")} value={data.output ?? ""} disabled={running || action === "delete" || action === "rename" || (data.near ?? true)} onChange={(event) => patch({ output: event.currentTarget.value })} className="min-w-0 flex-1" />
          <Field label={t("module:mvz.separatorLabel")} value={separator} disabled={running} onChange={(event) => patch({ separator: event.currentTarget.value })} className="min-w-0 flex-1" />
          {action === "rename" ? (
            <>
              <Field label={t("module:mvz.patternLabel")} value={data.pattern ?? ""} disabled={running} onChange={(event) => patch({ pattern: event.currentTarget.value })} className="min-w-0 flex-1" />
              <Field label={t("module:mvz.replacementLabel")} value={data.replacement ?? ""} disabled={running} onChange={(event) => patch({ replacement: event.currentTarget.value })} className="min-w-0 flex-1" />
            </>
          ) : null}
        </div>

        <TextArea
          label={t("module:mvz.archiveEntriesLabel")}
          value={data.entryText ?? ""}
          disabled={running}
          onChange={(event) => patch({ entryText: event.currentTarget.value })}
          placeholder={t("module:mvz.archiveEntriesPlaceholder")}
        />

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:mvz.successLabel")} value={result?.successCount ?? 0} tone="good" />
          <StatPill label={t("module:mvz.failedLabel")} value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
          <StatPill label={t("module:mvz.archivesLabel")} value={result?.totalArchives ?? archives} tone="accent" />
          <StatPill label={t("module:mvz.filesLabel")} value={result?.totalFiles ?? entries.length} />
          <StatPill label={t("module:mvz.progressLabel")} value={`${data.progress ?? 0}%`} />
        </div>

        <ResultView className="h-24 shrink-0 text-muted-foreground">
          {result?.preview.length ? result.preview.slice(0, 80).map((item) => (
            <div key={`${item.action}:${item.archive}:${item.command ?? ""}`} className="mb-1 truncate">
              {t("module:mvz.planLabel")} {item.action} {item.count} / {item.command}
            </div>
          )) : result?.results.length ? result.results.slice(0, 80).map((item) => (
            <div key={`${item.action}:${item.archive}:${item.message}`} className={item.success ? "mb-1 truncate" : "mb-1 truncate text-red-500"}>
              {item.success ? t("module:mvz.okLabel") : t("module:mvz.failLabel")} {item.action} {item.archive} / {item.message}
            </div>
          )) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">{data.progressText || t("module:mvz.noOperation")}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function canRun(action: MvzAction, entryCount: number, data: MvzCardState): boolean {
  if (!entryCount) return false
  if (action === "rename") return Boolean(data.pattern)
  return true
}

function buildInput(action: MvzAction, data: MvzCardState): MvzInput {
  return {
    action,
    fileText: data.entryText,
    output: data.output,
    near: data.near ?? true,
    autoDir: data.autoDir ?? true,
    flatten: data.flatten ?? false,
    pattern: data.pattern,
    replacement: data.replacement ?? "",
    separator: data.separator || "//",
    dryRun: data.dryRun ?? true,
  }
}
