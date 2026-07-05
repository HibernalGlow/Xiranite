import { useState } from "react"
import type { NodeCardProps } from "@xiranite/contract"
import { Clipboard, Copy, PackageCheck, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill } from "@xiranite/ui"
import type { ReinstallpData, ReinstallpInput, ReinstallpResult } from "./core.js"

interface ReinstallpCardState {
  rootPath?: string
  useSystem?: boolean
  selectedProjects?: string[]
  result?: ReinstallpData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeCardProps) {
  const data = host.getData<ReinstallpCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const projects = data.result?.projects ?? []
  const selected = data.selectedProjects ?? projects.map((project) => project.path)
  const useSystem = data.useSystem ?? true

  function patch(patchData: Partial<ReinstallpCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pasteRoot() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ rootPath: text.trim() })
  }

  async function execute(input: ReinstallpInput) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-reinstallp CLI to scan or install packages.")
      return
    }
    setRunning(true)
    patch({ phase: "running" })
    const response = await runNode<ReinstallpInput, ReinstallpData>("reinstallp", input) as ReinstallpResult
    patch({
      phase: response.success ? "completed" : "error",
      result: response.data ?? null,
      selectedProjects: response.data?.projects?.map((project) => project.path) ?? selected,
    })
    log(response.message)
    setRunning(false)
  }

  function toggle(path: string) {
    patch({ selectedProjects: selected.includes(path) ? selected.filter((item) => item !== path) : [...selected, path] })
  }

  function reset() {
    patch({ phase: "idle", result: null, logs: [], selectedProjects: [] })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title="reinstallp"
        meta={`${projects.length} project(s) / ${selected.length} selected / ${useSystem ? "--system" : "local"}`}
        actions={
          <>
            <IconButton title="Paste root" onClick={pasteRoot}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running || !data.rootPath} onClick={() => execute({ action: "scan", path: data.rootPath })}><Search size={14} /> Scan</ActionButton>
            <ActionButton variant="primary" disabled={running || !selected.length} onClick={() => execute({ action: "install", projects: selected, useSystem })}><PackageCheck size={14} /> Install</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 items-end gap-2">
          <Field label="root path" value={data.rootPath ?? ""} disabled={running} onChange={(event) => patch({ rootPath: event.currentTarget.value })} className="flex-1" />
          <SegmentButton active={useSystem} onClick={() => patch({ useSystem: !useSystem })}>{useSystem ? "--system" : "local"}</SegmentButton>
          <StatPill label="ok" value={data.result?.installedCount ?? 0} tone="good" />
          <StatPill label="fail" value={data.result?.failedCount ?? 0} tone={data.result?.failedCount ? "bad" : "neutral"} />
        </div>

        <ResultView className="min-h-0 flex-1">
          {projects.length ? projects.map((project) => (
            <button key={project.path} className={`mb-1 w-full rounded px-2 py-1 text-left ${selected.includes(project.path) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`} onClick={() => toggle(project.path)}>
              <div className="truncate font-semibold">{project.name}</div>
              <div className="truncate text-[10px]">{project.path}</div>
            </button>
          )) : <div className="flex h-full items-center justify-center text-muted-foreground">No scan result</div>}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}
