import { useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Archive, Clipboard, Copy, ExternalLink, FileArchive, Package, Play, RotateCcw } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea } from "@xiranite/ui"
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

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<BandiaCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const mode = data.mode ?? "extract"
  const logs = data.logs ?? []
  const paths = parseBandiaPaths(data.pathText ?? "")
  const mappings = parsePathMappings(data.mappingText ?? "")
  const result = data.result ?? null
  const dryRun = data.dryRun ?? true

  function patch(patchData: Partial<BandiaCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
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
    if (!host.runNode) {
      log("Host runner unavailable. Use the xiranite-bandia CLI for Bandizip filesystem actions.")
      return
    }

    setRunning(true)
    patch({ phase: action, progress: 0, progressText: "starting", result: null })
    const response = await host.runNode<BandiaInput, BandiaData>("bandia", input, (event) => {
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
    setRunning(false)
  }

  async function exportEfu() {
    await execute("export_efu")
  }

  async function copyResults() {
    const lines = [
      ...(result?.pathMappings ?? []).map((mapping) => `${mapping.archivePath} => ${mapping.extractedPath}`),
      ...(result?.results ?? []).map((item) => `${item.success ? "ok" : "fail"} ${item.sourcePath}${item.outputPath ? ` -> ${item.outputPath}` : ""}${item.error ? ` / ${item.error}` : ""}`),
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
        title="bandia"
        meta={`${mode} / ${dryRun ? "dry-run" : "live"} / ${paths.length} archive(s) / ${mappings.length} mapping(s)`}
        actions={
          <>
            <IconButton title="Paste input" disabled={running} onClick={pasteInput}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={running || !canRun(mode, paths, mappings)} onClick={() => execute()}><Play size={14} /> Run</ActionButton>
            <IconButton title="Export EFU" disabled={running || (!paths.length && !mappings.length)} onClick={exportEfu}><ExternalLink size={14} /></IconButton>
            <IconButton title="Copy results" onClick={copyResults}><Copy size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Archive size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={mode === "extract"} disabled={running} onClick={() => patch({ mode: "extract" })}><FileArchive size={14} /> Extract</SegmentButton>
          <SegmentButton active={mode === "compress"} disabled={running} onClick={() => patch({ mode: "compress" })}><Package size={14} /> Compress</SegmentButton>
          <SegmentButton active={dryRun} disabled={running} onClick={() => patch({ dryRun: !dryRun })}>dry-run</SegmentButton>
          {mode === "extract" ? (
            <>
              <SegmentButton active={data.deleteAfter ?? true} disabled={running} onClick={() => patch({ deleteAfter: !(data.deleteAfter ?? true) })}>delete</SegmentButton>
              <SegmentButton active={data.useTrash ?? true} disabled={running} onClick={() => patch({ useTrash: !(data.useTrash ?? true) })}>trash</SegmentButton>
              <SegmentButton active={(data.extractMode ?? "auto") === "auto"} disabled={running} onClick={() => patch({ extractMode: (data.extractMode ?? "auto") === "auto" ? "normal" : "auto" })}>{data.extractMode ?? "auto"}</SegmentButton>
              <SegmentButton active={data.parallel ?? false} disabled={running} onClick={() => patch({ parallel: !(data.parallel ?? false) })}>parallel</SegmentButton>
            </>
          ) : (
            <>
              <SegmentButton active={data.deleteSource ?? true} disabled={running} onClick={() => patch({ deleteSource: !(data.deleteSource ?? true) })}>delete source</SegmentButton>
              <SegmentButton active={(data.compressFormat ?? "zip") === "7z"} disabled={running} onClick={() => patch({ compressFormat: (data.compressFormat ?? "zip") === "zip" ? "7z" : "zip" })}>{data.compressFormat ?? "zip"}</SegmentButton>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          {mode === "extract" ? (
            <>
              <Field label="workers" type="number" value={data.workers ?? 2} disabled={running || !(data.parallel ?? false)} onChange={(event) => patch({ workers: Number(event.currentTarget.value) })} className="w-20" />
              <Field label="prefix" value={data.outputPrefix ?? "[extract] "} disabled={running || (data.extractMode ?? "auto") === "auto"} onChange={(event) => patch({ outputPrefix: event.currentTarget.value })} className="min-w-[8rem] flex-1" />
              <Field label="overwrite" value={data.overwriteMode ?? "overwrite"} disabled={running} onChange={(event) => patch({ overwriteMode: event.currentTarget.value as BandiaOverwriteMode })} className="w-28" />
            </>
          ) : (
            <Field label="output dir" value={data.outputDir ?? ""} disabled={running || mappings.length > 0} onChange={(event) => patch({ outputDir: event.currentTarget.value })} className="min-w-[10rem] flex-1" />
          )}
        </div>

        <div className="min-h-0 flex flex-1 gap-2">
          <TextArea
            label={mode === "extract" ? "archive paths" : "source paths"}
            value={data.pathText ?? ""}
            disabled={running}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            placeholder={mode === "extract" ? "one .zip/.7z/.rar path per line" : "folders/files to compress, one per line"}
          />
          {mode === "compress" ? (
            <TextArea
              label="mappings"
              value={data.mappingText ?? ""}
              disabled={running}
              onChange={(event) => patch({ mappingText: event.currentTarget.value })}
              placeholder={'{"mappings":[{"archivePath":"a.zip","extractedPath":"folder"}]}'}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="done" value={(result?.extractedCount ?? 0) + (result?.compressedCount ?? 0)} tone="good" />
          <StatPill label="failed" value={result?.failedCount ?? 0} tone={(result?.failedCount ?? 0) ? "bad" : "neutral"} />
          <StatPill label="mappings" value={result?.pathMappings.length ?? mappings.length} tone="accent" />
          <StatPill label="efu" value={result?.exportedCount ?? 0} />
          <StatPill label="progress" value={`${data.progress ?? 0}%`} />
        </div>

        <ResultView className="h-20 shrink-0 text-muted-foreground">
          {result?.results.length ? result.results.slice(0, 80).map((item) => (
            <div key={`${item.kind}:${item.sourcePath}:${item.outputPath ?? ""}`} className={item.success ? "truncate" : "truncate text-red-500"}>
              {item.success ? "ok" : "fail"} {item.sourcePath}{item.outputPath ? ` -> ${item.outputPath}` : ""}{item.error ? ` / ${item.error}` : ""}
            </div>
          )) : <div className="flex h-full items-center justify-center">{data.progressText || "No result"}</div>}
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
