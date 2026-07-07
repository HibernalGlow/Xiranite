import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Archive, Clipboard, Copy, ExternalLink, FileArchive, Package, Play, RotateCcw } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { BandiaAction, BandiaArchiveFormat, BandiaData, BandiaExtractMode, BandiaInput, BandiaResult, BandiaOverwriteMode, BandiaPathMapping } from "./core.js"
import { mappingsToText, parseBandiaPaths, parsePathMappings } from "./core.js"

interface BandiaCardState {
  mode?: "extract" | "compress"
  pathText?: string
  mappingText?: string
  outputDir?: string
  deleteAfter?: boolean
  useTrash?: boolean
  parallel?: boolean
  workers?: number
  extractMode?: BandiaExtractMode
  overwriteMode?: BandiaOverwriteMode
  outputPrefix?: string
  compressFormat?: BandiaArchiveFormat
  deleteSource?: boolean
  dryRun?: boolean
  result?: BandiaData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<BandiaCardState>(compId) ?? {}
  const dataRef = useRef<BandiaCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const mode = data.mode ?? "extract"
  const logs = data.logs ?? []
  const archivePaths = parseBandiaPaths(data.pathText ?? "")
  const sourcePaths = parseRawPaths(data.pathText ?? "")
  const paths = mode === "extract" ? archivePaths : sourcePaths
  const mappings = parsePathMappings(data.mappingText ?? "")
  const result = data.result ?? null
  const dryRun = data.dryRun ?? true

  function patch(patchData: Partial<BandiaCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
  }

  async function pasteInput() {
    const text = await host.clipboard?.readText?.()
    if (!text) return
    if (mode === "compress" && (text.trim().startsWith("{") || text.includes("=>"))) patch({ mappingText: text })
    else patch({ pathText: text })
  }

  async function execute(action: BandiaAction = mode) {
    if (running) return
    const input = buildInput(action, data, paths, mappings)
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for Bandizip filesystem actions.")

    setRunning(true)
    try {
      patch({ phase: action, progress: 0, progressText: t("module:bandia.starting"), result: null })
      const response = await runNativeAction<BandiaInput, BandiaData>("bandia", input, (event) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
        else log(event.message)
      }) as BandiaResult
  
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
        mappingText: response.data?.pathMappings.length ? mappingsToText(response.data.pathMappings) : data.mappingText,
        mode: response.data?.pathMappings.length ? "compress" : data.mode,
      })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  async function exportEfu() {
    await execute("export_efu")
  }

  async function copyResults() {
    const lines = [
      ...(result?.pathMappings ?? []).map((mapping) => `${mapping.archivePath} => ${mapping.extractedPath}`),
      ...(result?.results ?? []).map((item) => `${item.success ? "ok" : "fail"} ${item.sourcePath}${resultTarget(item) ? ` -> ${resultTarget(item)}` : ""}${item.error ? ` / ${item.error}` : ""}`),
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
        title={t("module:bandia.title")}
        meta={t("module:bandia.meta", {
          mode: t(`module:bandia.modes.${mode}`),
          state: dryRun ? t("module:bandia.dryRun") : t("module:bandia.live"),
          archives: paths.length,
          mappings: mappings.length,
        })}
        actions={
          <>
            <IconButton title={t("module:bandia.pasteInput")} disabled={running} onClick={pasteInput}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={running || !canRun(mode, paths, mappings)} onClick={() => execute()}><Play size={14} /> {t("module:bandia.run")}</ActionButton>
            <IconButton title={t("module:bandia.exportEfu")} disabled={running || (!paths.length && !mappings.length)} onClick={exportEfu}><ExternalLink size={14} /></IconButton>
            <IconButton title={t("module:bandia.copyResults")} onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title={t("module:bandia.copyLogs")} onClick={copyLogs}><Archive size={14} /></IconButton>
            <IconButton title={t("module:bandia.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={mode === "extract"} disabled={running} onClick={() => patch({ mode: "extract" })}><FileArchive size={14} /> {t("module:bandia.extract")}</SegmentButton>
          <SegmentButton active={mode === "compress"} disabled={running} onClick={() => patch({ mode: "compress" })}><Package size={14} /> {t("module:bandia.compress")}</SegmentButton>
          <SegmentButton active={dryRun} disabled={running} onClick={() => patch({ dryRun: !dryRun })}>{t("module:bandia.dryRun")}</SegmentButton>
          {mode === "extract" ? (
            <>
              <SegmentButton active={data.deleteAfter ?? true} disabled={running} onClick={() => patch({ deleteAfter: !(data.deleteAfter ?? true) })}>{t("module:bandia.delete")}</SegmentButton>
              <SegmentButton active={data.useTrash ?? true} disabled={running} onClick={() => patch({ useTrash: !(data.useTrash ?? true) })}>{t("module:bandia.trash")}</SegmentButton>
              <SegmentButton active={(data.extractMode ?? "auto") === "auto"} disabled={running} onClick={() => patch({ extractMode: (data.extractMode ?? "auto") === "auto" ? "normal" : "auto" })}>{t(`module:bandia.extractModes.${data.extractMode ?? "auto"}`)}</SegmentButton>
              <SegmentButton active={data.parallel ?? false} disabled={running} onClick={() => patch({ parallel: !(data.parallel ?? false) })}>{t("module:bandia.parallel")}</SegmentButton>
            </>
          ) : (
            <>
              <SegmentButton active={data.deleteSource ?? true} disabled={running} onClick={() => patch({ deleteSource: !(data.deleteSource ?? true) })}>{t("module:bandia.deleteSource")}</SegmentButton>
              <SegmentButton active={(data.compressFormat ?? "zip") === "7z"} disabled={running} onClick={() => patch({ compressFormat: (data.compressFormat ?? "zip") === "zip" ? "7z" : "zip" })}>{data.compressFormat ?? "zip"}</SegmentButton>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          {mode === "extract" ? (
            <>
              <Field label={t("module:bandia.workers")} type="number" value={data.workers ?? 2} disabled={running || !(data.parallel ?? false)} onChange={(event) => patch({ workers: Number(event.currentTarget.value) })} className="min-w-0 flex-1" />
              <Field label={t("module:bandia.prefix")} value={data.outputPrefix ?? "[extract] "} disabled={running || (data.extractMode ?? "auto") === "auto"} onChange={(event) => patch({ outputPrefix: event.currentTarget.value })} className="min-w-0 flex-1" />
              <Field label={t("module:bandia.overwrite")} value={data.overwriteMode ?? "overwrite"} disabled={running} onChange={(event) => patch({ overwriteMode: event.currentTarget.value as BandiaOverwriteMode })} className="min-w-0 flex-1" />
            </>
          ) : (
            <Field label={t("module:bandia.outputDir")} value={data.outputDir ?? ""} disabled={running || mappings.length > 0} onChange={(event) => patch({ outputDir: event.currentTarget.value })} className="min-w-0 flex-1" />
          )}
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <TextArea
            label={mode === "extract" ? t("module:bandia.archivePaths") : t("module:bandia.sourcePaths")}
            value={data.pathText ?? ""}
            disabled={running}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            placeholder={mode === "extract" ? t("module:bandia.placeholderArchivePaths") : t("module:bandia.placeholderSourcePaths")}
          />
          {mode === "compress" ? (
            <TextArea
              label={t("module:bandia.mappings")}
              value={data.mappingText ?? ""}
              disabled={running}
              onChange={(event) => patch({ mappingText: event.currentTarget.value })}
              placeholder={'{"mappings":[{"archivePath":"a.zip","extractedPath":"folder"}]}'}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:bandia.done")} value={(result?.extractedCount ?? 0) + (result?.compressedCount ?? 0)} tone="good" />
          <StatPill label={t("module:bandia.failed")} value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
          <StatPill label={t("module:bandia.mappings")} value={result?.pathMappings.length ?? mappings.length} tone="accent" />
          <StatPill label={t("module:bandia.efu")} value={result?.exportedCount ?? 0} />
          <StatPill label={t("module:bandia.progress")} value={`${data.progress ?? 0}%`} />
        </div>

        <ResultView className="h-20 shrink-0 text-muted-foreground">
          {result?.results.length ? result.results.slice(0, 80).map((item) => (
            <div key={`${item.kind}:${item.sourcePath}:${resultTarget(item) ?? ""}`} className={item.success ? "truncate" : "truncate text-red-500"}>
              {item.success ? t("module:bandia.ok") : t("module:bandia.fail")} {item.sourcePath}{resultTarget(item) ? ` -> ${resultTarget(item)}` : ""}{item.error ? ` / ${item.error}` : ""}
            </div>
          )) : <div className="flex h-full items-center justify-center">{data.progressText || t("module:bandia.noResult")}</div>}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function canRun(mode: "extract" | "compress", paths: string[], mappings: BandiaPathMapping[]): boolean {
  return mode === "extract" ? paths.length > 0 : paths.length > 0 || mappings.length > 0
}

function resultTarget(item: { outputPath?: string; archivePath?: string }): string | undefined {
  return item.outputPath ?? item.archivePath
}

function buildInput(action: BandiaAction, data: BandiaCardState, paths: string[], mappings: BandiaPathMapping[]): BandiaInput {
  return {
    action,
    paths,
    mappings,
    mappingText: data.mappingText,
    deleteAfter: data.deleteAfter ?? true,
    useTrash: data.useTrash ?? true,
    parallel: data.parallel ?? false,
    workers: data.workers ?? 2,
    extractMode: data.extractMode ?? "auto",
    outputPrefix: data.outputPrefix ?? "[extract] ",
    overwriteMode: data.overwriteMode ?? "overwrite",
    outputDir: data.outputDir,
    compressFormat: data.compressFormat ?? "zip",
    deleteSource: data.deleteSource ?? true,
    dryRun: data.dryRun ?? true,
    openInEverything: action === "export_efu",
  }
}

function parseRawPaths(text: string): string[] {
  const seen = new Set<string>()
  return text
    .split(/\r?\n|[;]/)
    .map((item) => stripOuterQuotes(item.trim()))
    .filter((item) => item && !seen.has(item) && Boolean(seen.add(item)))
}

function stripOuterQuotes(value: string): string {
  let result = value.trim()
  while (result.length >= 2 && isQuote(result[0]!) && isQuote(result[result.length - 1]!)) {
    result = result.slice(1, -1).trim()
  }
  if (result && isQuote(result[0]!)) result = result.slice(1).trim()
  if (result && isQuote(result[result.length - 1]!)) result = result.slice(0, -1).trim()
  return result
}

function isQuote(value: string): boolean {
  return value === "\"" || value === "'"
}
