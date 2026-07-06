import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Link, List, MoveRight, Play, RotateCcw } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill } from "@xiranite/ui"
import type { LinkRecord, LinkuData, LinkuInput, LinkuResult } from "./core.js"

interface LinkuCardState {
  path?: string
  target?: string
  configPath?: string
  action?: LinkuInput["action"]
  result?: LinkuData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<LinkuCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const links = data.result?.links ?? []

  function patch(patchData: Partial<LinkuCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function paste(field: "path" | "target" | "configPath") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  async function execute(action: LinkuInput["action"]) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-linku CLI for symlink actions.")
      return
    }
    setRunning(true)
    patch({ phase: "running", action })
    const response = await runNode<LinkuInput, LinkuData>("linku", {
      action,
      path: data.path,
      target: data.target,
      configPath: data.configPath,
    }) as LinkuResult
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
        title="linku"
        meta={`${data.phase ?? "idle"} / ${links.length} record(s)`}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("info")}><Play size={14} /> Info</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("create")}><Link size={14} /> Create</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("move_link")}><MoveRight size={14} /> Move</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("list")}><List size={14} /> List</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <PathField label="source" value={data.path ?? ""} disabled={running} onChange={(value) => patch({ path: value })} onPaste={() => paste("path")} />
          <PathField label="target/link" value={data.target ?? ""} disabled={running} onChange={(value) => patch({ target: value })} onPaste={() => paste("target")} />
          <PathField label="config" value={data.configPath ?? ""} disabled={running} onChange={(value) => patch({ configPath: value })} onPaste={() => paste("configPath")} />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex shrink-0 flex-wrap gap-1">
            <StatPill label="created" value={String(data.result?.created ?? false)} tone={data.result?.created ? "good" : "neutral"} />
            <StatPill label="recovered" value={data.result?.recoveredCount ?? 0} />
            <StatPill label="failed" value={data.result?.failedCount ?? 0} tone={data.result?.failedCount ? "bad" : "neutral"} />
            <ActionButton disabled={running} onClick={() => execute("recover")}>Recover</ActionButton>
          </div>
          <ResultView className="flex-1 text-muted-foreground">
            {data.result?.pathInfo ? <PathInfo info={data.result.pathInfo} /> : null}
            {links.length ? links.slice(0, 40).map((record) => <LinkRow key={record.link} record={record} />) : null}
            {!data.result ? "No result" : null}
          </ResultView>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function PathField(props: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; onPaste: () => void }) {
  return (
    <div className="flex min-w-0 gap-1">
      <Field label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} className="min-w-0 flex-1" />
      <IconButton title={`Paste ${props.label}`} onClick={props.onPaste} disabled={props.disabled}><Clipboard size={13} /></IconButton>
    </div>
  )
}

function PathInfo({ info }: { info: NonNullable<LinkuData["pathInfo"]> }) {
  return (
    <div className="grid gap-1">
      <div className="truncate">{info.path}</div>
      <div>exists: {String(info.exists)} / {info.kind}</div>
      <div>symlink: {String(info.isSymlink)}</div>
      {info.linkTarget ? <div className="truncate">-&gt; {info.linkTarget}</div> : null}
      {typeof info.sizeMb === "number" ? <div>{info.sizeMb.toFixed(2)} MB</div> : null}
    </div>
  )
}

function LinkRow({ record }: { record: LinkRecord }) {
  return (
    <div className="mb-1">
      <div className="truncate text-primary">{record.link}</div>
      <div className="truncate">-&gt; {record.target}</div>
    </div>
  )
}
