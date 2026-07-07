import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FileSearch, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { KavvkaAction, KavvkaData, KavvkaInput, KavvkaResult } from "./core.js"
import { DEFAULT_KAVVKA_KEYWORDS, parseKavvkaKeywords, parseKavvkaPaths } from "./core.js"

interface KavvkaCardState {
  sourceText?: string
  scanRootText?: string
  keywordText?: string
  scanDepth?: number
  force?: boolean
  dryRun?: boolean
  strictArtist?: boolean
  result?: KavvkaData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<KavvkaCardState>(compId) ?? {}
  const dataRef = useRef<KavvkaCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const sourcePaths = parseKavvkaPaths(data.sourceText)
  const scanRoots = parseKavvkaPaths(data.scanRootText)
  const keywords = parseKavvkaKeywords(data.keywordText).length ? parseKavvkaKeywords(data.keywordText) : DEFAULT_KAVVKA_KEYWORDS
  const result = data.result ?? null
  const logs = data.logs ?? []

  function patch(patchData: Partial<KavvkaCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function paste(kind: "source" | "scan") {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    patch(kind === "source" ? { sourceText: appendText(data.sourceText, text) } : { scanRootText: appendText(data.scanRootText, text) })
  }

  async function execute(action: KavvkaAction) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")

    const input = buildInput(action, data)
    if (action === "scan" && !scanRoots.length) return
    if (action !== "scan" && !sourcePaths.length) return

    setRunning(true)
    try {
      patch({ phase: action, progress: 0, progressText: t("module:kavvka.starting"), result: null })
      const response = await runNativeAction<KavvkaInput, KavvkaData>("kavvka", input, (event) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
        else log(event.message)
      }) as KavvkaResult
  
      const nextResult = response.data ?? null
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: nextResult,
        ...(action === "scan" && nextResult?.matchedPaths.length ? { sourceText: nextResult.matchedPaths.join("\n") } : {}),
      })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  async function copyResults() {
    const text = result?.allCombinedPaths.length ? result.allCombinedPaths.join("\n") : result?.matchedPaths.join("\n") ?? ""
    if (text) await host.clipboard?.writeText?.(text)
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
        title={t("module:kavvka.title")}
        meta={t("module:kavvka.meta", { sourceCount: sourcePaths.length, scanCount: scanRoots.length, depth: data.scanDepth ?? 3 })}
        actions={
          <>
            <IconButton title={t("module:kavvka.pasteSources")} disabled={running} onClick={() => paste("source")}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !scanRoots.length} onClick={() => execute("scan")}><Search size={14} /> {t("module:kavvka.scan")}</ActionButton>
            <ActionButton disabled={running || !sourcePaths.length} onClick={() => execute("plan")}><FileSearch size={14} /> {t("module:kavvka.plan")}</ActionButton>
            <ActionButton variant="primary" disabled={running || !sourcePaths.length} onClick={() => execute("process")}><Play size={14} /> {t("module:kavvka.process")}</ActionButton>
            <IconButton title={t("module:kavvka.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:kavvka.copyLogs")} onClick={copyLogs}><FileSearch size={14} /></IconButton>
            <IconButton title={t("module:kavvka.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label={t("module:kavvka.sourceFoldersLabel")}
            value={data.sourceText ?? ""}
            onChange={(event) => patch({ sourceText: event.currentTarget.value })}
            disabled={running}
            placeholder={t("module:kavvka.sourceFoldersPlaceholder")}
          />
          <TextArea
            label={t("module:kavvka.scanRootsLabel")}
            value={data.scanRootText ?? ""}
            onChange={(event) => patch({ scanRootText: event.currentTarget.value })}
            disabled={running}
            placeholder={t("module:kavvka.scanRootsPlaceholder")}
          />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:kavvka.keywordsLabel")} value={data.keywordText ?? DEFAULT_KAVVKA_KEYWORDS.join(", ")} disabled={running} onChange={(event) => patch({ keywordText: event.currentTarget.value })} />
          <Field label={t("module:kavvka.depthLabel")} type="number" min={0} max={10} value={data.scanDepth ?? 3} disabled={running} onChange={(event) => patch({ scanDepth: Number(event.currentTarget.value) })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.force ?? true} disabled={running} onClick={() => patch({ force: !(data.force ?? true) })}>{t("module:kavvka.forceMove")}</SegmentButton>
          <SegmentButton active={data.dryRun ?? true} disabled={running} onClick={() => patch({ dryRun: !(data.dryRun ?? true) })}>{t("module:kavvka.dryRun")}</SegmentButton>
          <SegmentButton active={data.strictArtist ?? false} disabled={running} onClick={() => patch({ strictArtist: !(data.strictArtist ?? false) })}>{t("module:kavvka.strictArtist")}</SegmentButton>
          <StatPill label={t("module:kavvka.statMatched")} value={result?.matchedPaths.length ?? 0} tone="accent" />
          <StatPill label={t("module:kavvka.statPaths")} value={result?.allCombinedPaths.length ?? 0} tone="good" />
          <StatPill label={t("module:kavvka.statMoved")} value={result?.movedCount ?? 0} />
          <StatPill label={t("module:kavvka.statErrors")} value={result?.errorCount ?? 0} tone={(result?.errorCount ?? 0) ? "bad" : "neutral"} />
        </div>

        <ResultView className="h-24 shrink-0 text-muted-foreground">
          {result?.allCombinedPaths.length ? result.allCombinedPaths.slice(0, 40).map((path) => (
            <div key={path} className="truncate">{path}</div>
          )) : result?.matchedPaths.length ? result.matchedPaths.slice(0, 60).map((path) => (
            <div key={path} className="truncate">{path}</div>
          )) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">{data.progressText || `${t("module:kavvka.keywordsLabel")}: ${keywords.slice(0, 4).join(", ")}`}</div>
          )}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function buildInput(action: KavvkaAction, data: KavvkaCardState): KavvkaInput {
  return {
    action,
    pathText: data.sourceText,
    scanRootText: data.scanRootText,
    keywordText: data.keywordText,
    scanDepth: data.scanDepth ?? 3,
    force: data.force ?? true,
    dryRun: action === "plan" ? true : data.dryRun ?? true,
    strictArtist: data.strictArtist ?? false,
  }
}

function appendText(current = "", next: string): string {
  return current.trim() ? `${current.trimEnd()}\n${next}` : next
}
