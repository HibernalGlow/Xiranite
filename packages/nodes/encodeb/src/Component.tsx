import { useState } from "react"
import type { ReactNode } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clipboard, Copy, FileText, Play, RotateCcw, Search, Zap } from "lucide-react"
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

export function Component({ compId, host }: NodeCardProps) {
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
    patch({
      preset: next,
      srcEncoding: config?.srcEncoding ?? srcEncoding,
      dstEncoding: config?.dstEncoding ?? dstEncoding,
    })
  }

  async function execute(action: EncodebInput["action"]) {
    if (!paths.length || running) return
    if (!host.runNode) {
      log("Host runner unavailable. Use the xiranite-encodeb CLI to scan, preview, or recover filenames.")
      return
    }

    setRunning(true)
    patch({ phase: action ?? "preview", mappings: [], matches: [] })
    const response = await host.runNode<EncodebInput, EncodebData>("encodeb", {
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
    <div className="h-full min-h-[330px] overflow-hidden p-3 text-xs font-mono">
      <div className="grid h-full min-h-0 grid-cols-[1.1fr_1fr_130px] grid-rows-[1fr_132px] gap-2">
        <Panel title="Source" action={<button title="Paste paths" onClick={pastePaths}><Clipboard size={13} /></button>}>
          <textarea
            value={pathText}
            onChange={(event) => patch({ pathText: event.currentTarget.value })}
            disabled={running}
            className="h-full w-full resize-none rounded border border-border bg-muted/30 p-2 text-xs outline-none"
            placeholder="one file or folder path per line"
          />
          <div className="mt-1 text-[10px] text-muted-foreground">{paths.length} path(s)</div>
        </Panel>
        <Panel title="Encoding">
          <div className="flex h-full flex-col gap-2">
            <div className="grid grid-cols-4 gap-1">
              {(["cn", "jp", "kr", "custom"] as const).map((key) => (
                <button key={key} className={`h-8 rounded border ${preset === key ? "border-primary bg-primary/10" : "border-border"}`} disabled={running} onClick={() => selectPreset(key)}>
                  {key}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[10px] text-muted-foreground">
                src
                <input value={srcEncoding} disabled={running || preset !== "custom"} onChange={(event) => patch({ srcEncoding: event.currentTarget.value })} className="h-8 rounded border border-border bg-background px-2 text-xs outline-none" />
              </label>
              <label className="grid gap-1 text-[10px] text-muted-foreground">
                dst
                <input value={dstEncoding} disabled={running || preset !== "custom"} onChange={(event) => patch({ dstEncoding: event.currentTarget.value })} className="h-8 rounded border border-border bg-background px-2 text-xs outline-none" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(["replace", "copy"] as const).map((mode) => (
                <button key={mode} className={`h-8 rounded border ${strategy === mode ? "border-primary bg-primary/10" : "border-border"}`} disabled={running} onClick={() => patch({ strategy: mode })}>
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Actions">
          <div className="flex h-full flex-col gap-2">
            <button className="flex flex-1 items-center justify-center gap-1 rounded border border-border disabled:opacity-50" disabled={!paths.length || running} onClick={() => execute("find")}>
              <Search size={14} /> Find
            </button>
            <button className="flex flex-1 items-center justify-center gap-1 rounded border border-border disabled:opacity-50" disabled={!paths.length || running} onClick={() => execute("preview")}>
              <FileText size={14} /> Preview
            </button>
            <button className="flex flex-1 items-center justify-center gap-1 rounded bg-primary text-primary-foreground disabled:opacity-50" disabled={!paths.length || running} onClick={() => execute("recover")}>
              <Zap size={14} /> Recover
            </button>
            <button className="flex h-8 items-center justify-center gap-1 rounded border border-border" onClick={reset}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </Panel>
        <Panel title="Preview" className="col-span-2">
          <div className="h-full overflow-auto rounded bg-muted/30 p-2 text-[11px]">
            {previewRows.length ? previewRows.slice(0, 80).map((row) => (
              <div key={`${row.src}:${row.dst}`} className="mb-1">
                <div className="truncate text-muted-foreground">{row.src}</div>
                {row.dst ? <div className="truncate text-primary">-&gt; {row.dst}</div> : null}
              </div>
            )) : <div className="flex h-full items-center justify-center text-muted-foreground">No preview rows</div>}
          </div>
        </Panel>
        <Panel title="Log" action={<button title="Copy logs" onClick={copyLogs}><Copy size={13} /></button>}>
          <div className="h-full overflow-auto rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
            {running ? <div>running...</div> : null}
            {logs.length ? logs.slice(-10).map((line) => <div key={line}>{line}</div>) : "No logs"}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Panel(props: { title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col gap-2 rounded border border-border bg-card/40 p-2 ${props.className ?? ""}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{props.title}</span>
        {props.action ? <div className="text-muted-foreground">{props.action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </section>
  )
}
