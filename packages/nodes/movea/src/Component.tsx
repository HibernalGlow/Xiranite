import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderInput, MoveRight, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill, TextArea } from "@xiranite/ui"
import { matchMoveaArchiveToFolders } from "./core.js"
import type { MoveaData, MoveaInput, MoveaResult } from "./core.js"

interface MoveaCardState {
  rootPath?: string
  regexText?: string
  archiveName?: string
  subfoldersText?: string
  level1Name?: string
  movePlanText?: string
  result?: MoveaData | null
  matchedFolders?: string[]
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<MoveaCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const scanResults = Object.values(data.result?.scanResults ?? {})

  function patch(patchData: Partial<MoveaCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function paste(field: "rootPath" | "archiveName" | "subfoldersText" | "level1Name" | "movePlanText") {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ [field]: text.trim() })
  }

  async function execute(action: MoveaInput["action"]) {
    if (running) return
    if (action === "match") {
      const matchedFolders = matchMoveaArchiveToFolders(
        data.archiveName ?? "",
        splitLines(data.subfoldersText),
        splitLines(data.regexText),
      )
      patch({ matchedFolders, phase: "preview" })
      log(`Matched ${matchedFolders.length} folder(s).`)
      return
    }
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-movea CLI for filesystem actions.")
      return
    }

    setRunning(true)
    patch({ phase: "running" })
    const input: MoveaInput = {
      action,
      rootPath: data.rootPath,
      regexPatterns: splitLines(data.regexText),
      level1Name: data.level1Name,
      movePlan: parseMovePlan(data.movePlanText),
    }
    const response = await runNode<MoveaInput, MoveaData>("movea", input, (event) => {
      if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
      else log(event.message)
    }) as MoveaResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  function reset() {
    patch({ result: null, matchedFolders: [], logs: [], phase: "idle" })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title="movea"
        meta={`${data.phase ?? "idle"} / ${scanResults.length} folder(s)`}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("scan")}><Search size={14} /> Scan</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("match")}><Play size={14} /> Match</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("move_single")}><MoveRight size={14} /> Move</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <PathField label="root" value={data.rootPath ?? ""} disabled={running} onChange={(value) => patch({ rootPath: value })} onPaste={() => paste("rootPath")} />
          <PathField label="level1" value={data.level1Name ?? ""} disabled={running} onChange={(value) => patch({ level1Name: value })} onPaste={() => paste("level1Name")} />
          <PathField label="archive" value={data.archiveName ?? ""} disabled={running} onChange={(value) => patch({ archiveName: value })} onPaste={() => paste("archiveName")} />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1">
              <StatPill label="folders" value={data.result?.totalFolders ?? 0} tone="accent" />
              <StatPill label="archives" value={data.result?.totalArchives ?? 0} />
              <StatPill label="movable" value={data.result?.totalMovableFolders ?? 0} />
            </div>
            <ResultView className="flex-1 text-muted-foreground">
              {scanResults.length ? scanResults.slice(0, 30).map((item) => (
                <div key={item.path} className="mb-2">
                  <div className="truncate text-primary">{item.name}</div>
                  <div className="truncate">{item.archives.length} archive(s), {item.movableFolders.length} loose folder(s), {item.subfolders.length} target(s)</div>
                </div>
              )) : data.matchedFolders?.length ? data.matchedFolders.map((folder) => <div key={folder} className="truncate">{folder}</div>) : "No result"}
            </ResultView>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <TextArea label="regex patterns" value={data.regexText ?? ""} disabled={running} onChange={(event) => patch({ regexText: event.currentTarget.value })} />
            <TextArea label="target folders" value={data.subfoldersText ?? ""} disabled={running} onChange={(event) => patch({ subfoldersText: event.currentTarget.value })} />
            <TextArea label="move plan JSON" value={data.movePlanText ?? ""} disabled={running} onChange={(event) => patch({ movePlanText: event.currentTarget.value })} />
            <IconButton title="Paste move plan" onClick={() => paste("movePlanText")} disabled={running}><Clipboard size={13} /></IconButton>
          </div>
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
    <div className="flex min-w-0 flex-1 gap-1">
      <Field label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} className="min-w-0 flex-1" />
      <IconButton title={`Paste ${props.label}`} onClick={props.onPaste} disabled={props.disabled}><FolderInput size={13} /></IconButton>
    </div>
  )
}

function splitLines(value?: string): string[] {
  return (value ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

function parseMovePlan(value?: string): Record<string, string | null> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string | null> : {}
  } catch {
    return {}
  }
}
