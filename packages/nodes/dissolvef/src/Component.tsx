import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, FolderInput, FolderOpen, History, Play, RotateCcw, Undo2 } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { DissolvefData, DissolvefInput, DissolvefResult } from "./core.js"

interface DissolvefCardState {
  pathText?: string
  historyPath?: string
  excludeText?: string
  nested?: boolean
  media?: boolean
  archive?: boolean
  direct?: boolean
  preview?: boolean
  protectFirstLevel?: boolean
  enableSimilarity?: boolean
  similarityThreshold?: number
  fileConflict?: string
  dirConflict?: string
  undoId?: string
  result?: DissolvefData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<DissolvefCardState>(compId) ?? {}
  const dataRef = useRef<DissolvefCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const nested = data.nested ?? true
  const media = data.media ?? true
  const archive = data.archive ?? true
  const direct = data.direct ?? false
  const preview = data.preview ?? false
  const protectFirstLevel = data.protectFirstLevel ?? true
  const enableSimilarity = data.enableSimilarity ?? true
  const threshold = data.similarityThreshold ?? 0.6
  const plan = data.result?.plan ?? []
  const history = data.result?.history ?? []

  function patch(patchData: Partial<DissolvefCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function paste(field: "pathText" | "historyPath" | "excludeText") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  async function execute(action: DissolvefInput["action"]) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")
    setRunning(true)
    try {
      patch({ phase: "running" })
      const response = await runNativeAction<DissolvefInput, DissolvefData>("dissolvef", {
        action,
        path: data.pathText,
        historyPath: data.historyPath,
        undoId: data.undoId,
        exclude: data.excludeText,
        nested,
        media,
        archive,
        direct,
        preview: action === "plan" ? true : preview,
        protectFirstLevel,
        enableSimilarity,
        similarityThreshold: threshold,
        fileConflict: data.fileConflict as DissolvefInput["fileConflict"],
        dirConflict: data.dirConflict as DissolvefInput["dirConflict"],
      }, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as DissolvefResult
      patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  function setMode(mode: "bundle" | "direct") {
    if (mode === "direct") patch({ direct: true, nested: false, media: false, archive: false })
    else patch({ direct: false, nested: true, media: true, archive: true })
  }

  function toggleMode(key: "nested" | "media" | "archive") {
    patch({ direct: false, [key]: !(data[key] ?? true) })
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  const modeParts = [
    nested ? t("module:dissolvef.nested") : "",
    media ? t("module:dissolvef.media") : "",
    archive ? t("module:dissolvef.archive") : "",
  ].filter(Boolean)
  const modeText = direct ? t("module:dissolvef.direct") : (modeParts.length ? modeParts.join("+") : t("module:dissolvef.none"))

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:dissolvef.title")}
        meta={t("module:dissolvef.meta", {
          phase: t(`module:dissolvef.phases.${data.phase ?? "idle"}`),
          mode: modeText,
        })}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("plan")}><Play size={14} /> {t("module:dissolvef.plan")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute(direct ? "direct" : "dissolve")}><FolderInput size={14} /> {t("module:dissolvef.run")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("history")}><History size={14} /> {t("module:dissolvef.history")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("undo")}><Undo2 size={14} /> {t("module:dissolvef.undo")}</ActionButton>
            <IconButton title={t("module:dissolvef.copyLogs")} onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title={t("module:dissolvef.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:dissolvef.folder")} value={data.pathText ?? ""} disabled={running} onChange={(event) => patch({ pathText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:dissolvef.pasteFolder")} onClick={() => paste("pathText")} disabled={running}><FolderOpen size={13} /></IconButton>
          <Field label={t("module:dissolvef.historyPath")} value={data.historyPath ?? ""} disabled={running} onChange={(event) => patch({ historyPath: event.currentTarget.value })} className="min-w-0 flex-1" />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={!direct} disabled={running} onClick={() => setMode("bundle")}>{t("module:dissolvef.bundle")}</SegmentButton>
          <SegmentButton active={direct} disabled={running} onClick={() => setMode("direct")}>{t("module:dissolvef.direct")}</SegmentButton>
          <SegmentButton active={nested && !direct} disabled={running || direct} onClick={() => toggleMode("nested")}>{t("module:dissolvef.nested")}</SegmentButton>
          <SegmentButton active={media && !direct} disabled={running || direct} onClick={() => toggleMode("media")}>{t("module:dissolvef.media")}</SegmentButton>
          <SegmentButton active={archive && !direct} disabled={running || direct} onClick={() => toggleMode("archive")}>{t("module:dissolvef.archive")}</SegmentButton>
          <SegmentButton active={preview} disabled={running} onClick={() => patch({ preview: !preview })}>{t("module:dissolvef.preview")}</SegmentButton>
          <SegmentButton active={protectFirstLevel} disabled={running || direct} onClick={() => patch({ protectFirstLevel: !protectFirstLevel })}>{t("module:dissolvef.protect")}</SegmentButton>
          <SegmentButton active={enableSimilarity} disabled={running || direct} onClick={() => patch({ enableSimilarity: !enableSimilarity })}>{t("module:dissolvef.similarity")}</SegmentButton>
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:dissolvef.exclude")} value={data.excludeText ?? ""} disabled={running} onChange={(event) => patch({ excludeText: event.currentTarget.value })} className="min-w-0 flex-1" />
          <Field label={t("module:dissolvef.threshold")} type="number" min={0} max={1} step={0.05} value={threshold} disabled={running || direct || !enableSimilarity} onChange={(event) => patch({ similarityThreshold: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
          <Field label={t("module:dissolvef.fileConflict")} value={data.fileConflict ?? "auto"} disabled={running || !direct} onChange={(event) => patch({ fileConflict: event.currentTarget.value })} className="min-w-0 flex-1" />
          <Field label={t("module:dissolvef.dirConflict")} value={data.dirConflict ?? "auto"} disabled={running || !direct} onChange={(event) => patch({ dirConflict: event.currentTarget.value })} className="min-w-0 flex-1" />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:dissolvef.nested")} value={data.result?.nestedCount ?? 0} tone="good" />
          <StatPill label={t("module:dissolvef.media")} value={data.result?.mediaCount ?? 0} tone="good" />
          <StatPill label={t("module:dissolvef.archive")} value={data.result?.archiveCount ?? 0} tone="good" />
          <StatPill label={t("module:dissolvef.direct")} value={`${data.result?.directFiles ?? 0}/${data.result?.directDirs ?? 0}`} tone="accent" />
          <StatPill label={t("module:dissolvef.skipped")} value={data.result?.skippedCount ?? 0} />
          <StatPill label={t("module:dissolvef.errors")} value={data.result?.errorCount ?? data.result?.failedCount ?? 0} tone={(data.result?.errorCount || data.result?.failedCount) ? "bad" : "neutral"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {plan.length ? plan.slice(0, 80).map((item, index) => (
            <div key={`${index}:${item.sourcePath}:${item.targetPath}`} className="mb-1 truncate">
              {item.status} {item.mode} {item.operation} {item.sourcePath}{item.targetPath ? ` -> ${item.targetPath}` : item.reason ? ` / ${item.reason}` : ""}
            </div>
          )) : history.length ? history.slice(0, 20).map((item) => (
            <div key={item.id} className="mb-1 truncate">
              {item.id} / {item.mode} / {item.count} {t("module:dissolvef.operations")}{item.undone ? ` / ${t("module:dissolvef.undone")}` : ""}
            </div>
          )) : t("module:dissolvef.noResult")}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}
