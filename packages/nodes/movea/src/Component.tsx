import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, FolderInput, MoveRight, Play, RotateCcw, Search } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
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
  const { t } = useTranslation()
  const data = host.getData<MoveaCardState>(compId) ?? {}
  const dataRef = useRef<MoveaCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const scanResults = Object.values(data.result?.scanResults ?? {})

  function patch(patchData: Partial<MoveaCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-40), message] })
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
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for filesystem actions.")

    setRunning(true)
    try {
      patch({ phase: "running" })
      const input: MoveaInput = {
        action,
        rootPath: data.rootPath,
        regexPatterns: splitLines(data.regexText),
        level1Name: data.level1Name,
        movePlan: parseMovePlan(data.movePlanText),
      }
      const response = await runNativeAction<MoveaInput, MoveaData>("movea", input, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as MoveaResult
      patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
      log(response.message)
    } finally {
      setRunning(false)
    }
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
        title={t("module:movea.title")}
        meta={t("module:movea.meta", { phase: data.phase ?? "idle", count: scanResults.length })}
        actions={
          <>
            <ActionButton disabled={running} onClick={() => execute("scan")}><Search size={14} /> {t("module:movea.scan")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("match")}><Play size={14} /> {t("module:movea.match")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("move_single")}><MoveRight size={14} /> {t("module:movea.move")}</ActionButton>
            <IconButton title={t("module:movea.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title={t("module:movea.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <PathField label={t("module:movea.rootLabel")} value={data.rootPath ?? ""} disabled={running} onChange={(value) => patch({ rootPath: value })} onPaste={() => paste("rootPath")} />
          <PathField label={t("module:movea.level1Label")} value={data.level1Name ?? ""} disabled={running} onChange={(value) => patch({ level1Name: value })} onPaste={() => paste("level1Name")} />
          <PathField label={t("module:movea.archiveLabel")} value={data.archiveName ?? ""} disabled={running} onChange={(value) => patch({ archiveName: value })} onPaste={() => paste("archiveName")} />
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap gap-1">
              <StatPill label={t("module:movea.foldersLabel")} value={data.result?.totalFolders ?? 0} tone="accent" />
              <StatPill label={t("module:movea.archivesLabel")} value={data.result?.totalArchives ?? 0} />
              <StatPill label={t("module:movea.movableLabel")} value={data.result?.totalMovableFolders ?? 0} />
            </div>
            <ResultView className="flex-1 text-muted-foreground">
              {scanResults.length ? scanResults.slice(0, 30).map((item) => (
                <div key={item.path} className="mb-2">
                  <div className="truncate text-primary">{item.name}</div>
                  <div className="truncate">{t("module:movea.scanSummary", { archives: item.archives.length, movable: item.movableFolders.length, targets: item.subfolders.length })}</div>
                </div>
              )) : data.matchedFolders?.length ? data.matchedFolders.map((folder) => <div key={folder} className="truncate">{folder}</div>) : t("module:movea.noResult")}
            </ResultView>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <TextArea label={t("module:movea.regexPatternsLabel")} value={data.regexText ?? ""} disabled={running} onChange={(event) => patch({ regexText: event.currentTarget.value })} />
            <TextArea label={t("module:movea.targetFoldersLabel")} value={data.subfoldersText ?? ""} disabled={running} onChange={(event) => patch({ subfoldersText: event.currentTarget.value })} />
            <TextArea label={t("module:movea.movePlanLabel")} value={data.movePlanText ?? ""} disabled={running} onChange={(event) => patch({ movePlanText: event.currentTarget.value })} />
            <IconButton title={t("module:movea.pasteMovePlan")} onClick={() => paste("movePlanText")} disabled={running}><Clipboard size={13} /></IconButton>
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
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      <Field label={props.label} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} className="min-w-0 flex-1" />
      <IconButton title={t("module:movea.pasteField", { field: props.label })} onClick={props.onPaste} disabled={props.disabled}><FolderInput size={13} /></IconButton>
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
