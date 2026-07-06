import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FileText, RotateCcw, Search, Zap } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { EncodebData, EncodebInput, EncodebMapping, EncodebResult, EncodebStrategy } from "./core.js"
import { ENCODEB_PRESETS, parseEncodebPaths } from "./core.js"

interface EncodebCardState {
  pathText?: string
  preset?: keyof typeof ENCODEB_PRESETS | "custom"
  srcEncoding?: string
  dstEncoding?: string
  strategy?: EncodebStrategy
  phase?: string
  logs?: string[]
  mappings?: EncodebMapping[]
  matches?: string[]
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<EncodebCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const pathText = data.pathText ?? ""
  const preset = data.preset ?? "cn"
  const presetConfig = preset === "custom" ? null : ENCODEB_PRESETS[preset]
  const srcEncoding = data.srcEncoding ?? presetConfig?.srcEncoding ?? "cp437"
  const dstEncoding = data.dstEncoding ?? presetConfig?.dstEncoding ?? "cp936"
  const strategy = data.strategy ?? "replace"
  const paths = parseEncodebPaths(pathText)
  const logs = data.logs ?? []

  function patch(patchData: Partial<EncodebCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pastePaths() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ pathText: pathText ? `${pathText}\n${text}` : text })
  }

  function selectPreset(next: keyof typeof ENCODEB_PRESETS | "custom") {
    const config = next === "custom" ? null : ENCODEB_PRESETS[next]
    patch({ preset: next, srcEncoding: config?.srcEncoding ?? srcEncoding, dstEncoding: config?.dstEncoding ?? dstEncoding })
  }

  async function execute(action: EncodebInput["action"]) {
    if (!paths.length || running) return
    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the xiranite-encodeb CLI to scan, preview, or recover filenames.")

    setRunning(true)
    patch({ phase: action ?? "preview", mappings: [], matches: [] })
    const response = await runNativeAction<EncodebInput, EncodebData>("encodeb", {
      action,
      paths,
      srcEncoding,
      dstEncoding,
      strategy,
    }, (event) => {
      if (event.type === "log") log(event.message)
    }) as EncodebResult

    patch({
      phase: response.success ? "completed" : "error",
      mappings: response.data?.mappings ?? [],
      matches: response.data?.matches ?? [],
    })
    log(response.message)
    setRunning(false)
  }

  function reset() {
    patch({ phase: "idle", logs: [], mappings: [], matches: [] })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  const previewRows = data.mappings?.length ? data.mappings : (data.matches ?? []).map((match) => ({ src: match, dst: "", type: "file", depth: 0 } satisfies EncodebMapping))

  return (
    <NodeContent>
      <NodeHeader
        title="encodeb"
        meta={`${paths.length} path(s) / ${srcEncoding} -> ${dstEncoding} / ${strategy}`}
        actions={
          <>
            <IconButton title="Paste paths" onClick={pastePaths}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={!paths.length || running} onClick={() => execute("find")}><Search size={14} /> Find</ActionButton>
            <ActionButton disabled={!paths.length || running} onClick={() => execute("preview")}><FileText size={14} /> Preview</ActionButton>
            <ActionButton variant="primary" disabled={!paths.length || running} onClick={() => execute("recover")}><Zap size={14} /> Recover</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label="paths"
            value={pathText}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            disabled={running}
            placeholder="one file or folder path per line"
          />
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1">
              {(["cn", "jp", "kr", "custom"] as const).map((key) => (
                <SegmentButton key={key} active={preset === key} disabled={running} onClick={() => selectPreset(key)}>
                  {key}
                </SegmentButton>
              ))}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Field label="src" value={srcEncoding} disabled={running || preset !== "custom"} onChange={(event) => patch({ srcEncoding: event.currentTarget.value })} />
              <Field label="dst" value={dstEncoding} disabled={running || preset !== "custom"} onChange={(event) => patch({ dstEncoding: event.currentTarget.value })} />
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <SegmentButton active={strategy === "replace"} disabled={running} onClick={() => patch({ strategy: "replace" })}>replace</SegmentButton>
              <SegmentButton active={strategy === "copy"} disabled={running} onClick={() => patch({ strategy: "copy" })}>copy</SegmentButton>
              <StatPill label="preview" value={data.mappings?.length ?? 0} tone="accent" />
              <StatPill label="matches" value={data.matches?.length ?? 0} />
            </div>
            <ResultView className="flex-1 text-muted-foreground">
              {previewRows.length ? previewRows.slice(0, 80).map((row) => (
                <div key={`${row.src}:${row.dst}`} className="mb-1">
                  <div className="truncate">{row.src}</div>
                  {row.dst ? <div className="truncate text-primary">-&gt; {row.dst}</div> : null}
                </div>
              )) : <div className="flex h-full items-center justify-center">No preview rows</div>}
            </ResultView>
          </div>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? ["running...", ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}
