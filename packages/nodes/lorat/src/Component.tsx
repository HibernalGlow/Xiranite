import { useMemo, useRef, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Database, Download, FileCheck2, RefreshCw, RotateCcw, Tags, XCircle } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
import type { LoratData, LoratInput, LoratResult, LoratRow, LoratScopeFilter, LoratStatusFilter } from "./core.js"
import { DEFAULT_LORA_FOLDER, collectTriggerDb, filterLoratRows, summarizeLoratRows } from "./core.js"

interface LoratCardState {
  folderPath?: string
  triggerDbJson?: string
  search?: string
  statusFilter?: LoratStatusFilter
  scopeFilter?: LoratScopeFilter
  rows?: LoratRow[]
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
  dbOpen?: boolean
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<LoratCardState>(compId) ?? {}
  const dataRef = useRef<LoratCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [, setRevision] = useState(0)
  const folderPath = data.folderPath ?? DEFAULT_LORA_FOLDER
  const rows = data.rows ?? []
  const logs = data.logs ?? []
  const filteredRows = useMemo(() => filterLoratRows(rows, {
    search: data.search,
    statusFilter: data.statusFilter,
    scopeFilter: data.scopeFilter,
  }), [rows, data.search, data.statusFilter, data.scopeFilter])
  const stats = summarizeLoratRows(rows)
  const filteredStats = summarizeLoratRows(filteredRows)
  const selectedKeys = rows.filter((row) => row.selected).map((row) => row.key)

  function patch(patchData: Partial<LoratCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
    setRevision((value) => value + 1)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-50), message] })
  }

  async function pasteFolder() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ folderPath: text.trim() })
  }

  async function pasteDb() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ triggerDbJson: text, dbOpen: true })
  }

  async function execute(action: LoratInput["action"], overrideKeys?: string[]) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the lorat CLI for filesystem actions.")
    const input: LoratInput = {
      action,
      folderPath,
      triggerDbJson: data.triggerDbJson,
      rows,
      selectedKeys: overrideKeys ?? selectedKeys,
    }
    setRunning(true)
    try {
      patch({ phase: action, progress: 0, progressText: actionLabel(action) })
      const response = await runNativeAction<LoratInput, LoratData>("lorat", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
        } else {
          log(event.message)
        }
      }) as LoratResult

      const next = response.data
      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        rows: next?.rows ?? rows,
        triggerDbJson: next?.triggerDbJson || data.triggerDbJson,
      })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  function updateRow(key: string, patchRow: Partial<LoratRow>) {
    patch({ rows: rows.map((row) => row.key === key ? { ...row, ...patchRow } : row) })
  }

  function toggleRow(row: LoratRow) {
    updateRow(row.key, { selected: !row.selected })
  }

  function editTrigger(row: LoratRow, trigger: string) {
    updateRow(row.key, {
      trigger,
      changed: trigger.trim() !== row.originalTrigger.trim(),
      status: trigger.trim() ? "trigger" : row.status,
    })
  }

  function selectMissing() {
    const visible = new Set(filteredRows.map((row) => row.key))
    patch({
      rows: rows.map((row) => visible.has(row.key) ? { ...row, selected: row.status === "missing" } : row),
    })
  }

  function clearSelection() {
    patch({ rows: rows.map((row) => row.selected ? { ...row, selected: false } : row) })
  }

  function reset() {
    patch({ rows: [], logs: [], phase: "idle", progress: 0, progressText: "", search: "", statusFilter: "all", scopeFilter: "all" })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function exportDb() {
    const db = collectTriggerDb(rows)
    const json = `${JSON.stringify(db, null, 2)}\n`
    patch({ triggerDbJson: json, dbOpen: true })
    host.downloadText?.("lora-triggers.generated.json", json)
    await host.clipboard?.writeText?.(json)
  }

  return (
    <NodeContent className="lorat-scope">
      <style>{LORAT_CONTAINER_CSS}</style>
      <NodeHeader
        title="Lorat"
        meta={`${stats.total} LoRA / ${stats.missing} missing / ${stats.trigger} trigger / ${stats.notrigger} no trigger`}
        actions={
          <>
            <IconButton title="Paste folder" disabled={running} onClick={pasteFolder}><Clipboard size={14} /></IconButton>
            <ActionButton variant="primary" disabled={running || !folderPath} onClick={() => execute("scan")}><RefreshCw size={14} /> Scan</ActionButton>
            <ActionButton disabled={running || !rows.length} onClick={pasteDb}><Database size={14} /> JSON</ActionButton>
            <ActionButton disabled={running || !rows.length} onClick={() => execute("apply_db")}><Tags size={14} /> Apply</ActionButton>
            <IconButton title="Reset" disabled={running} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="min-h-0">
        <div className="lorat-shell">
          <div className="lorat-controls">
            <Field label="folder" value={folderPath} disabled={running} onChange={(event) => patch({ folderPath: event.currentTarget.value })} />
            <Field label="search" value={data.search ?? ""} disabled={running} onChange={(event) => patch({ search: event.currentTarget.value })} />
            <label className="lorat-select">
              <span>status</span>
              <select value={data.statusFilter ?? "all"} disabled={running} onChange={(event) => patch({ statusFilter: event.currentTarget.value as LoratStatusFilter })}>
                <option value="all">all</option>
                <option value="missing">missing</option>
                <option value="trigger">trigger</option>
                <option value="notrigger">no trigger</option>
              </select>
            </label>
            <label className="lorat-select">
              <span>scope</span>
              <select value={data.scopeFilter ?? "all"} disabled={running} onChange={(event) => patch({ scopeFilter: event.currentTarget.value as LoratScopeFilter })}>
                <option value="all">all</option>
                <option value="self">self</option>
                <option value="at">@</option>
              </select>
            </label>
          </div>

          <div className="lorat-actions">
            <ActionButton disabled={running || !filteredRows.length} onClick={selectMissing}><FileCheck2 size={14} /> Missing</ActionButton>
            <ActionButton disabled={running || !selectedKeys.length} onClick={() => execute("write_triggers")}><Tags size={14} /> Write</ActionButton>
            <ActionButton disabled={running || !selectedKeys.length} onClick={() => execute("mark_no_trigger")}><XCircle size={14} /> None</ActionButton>
            <ActionButton disabled={running || !rows.length} onClick={exportDb}><Download size={14} /> Export</ActionButton>
            <IconButton title="Clear selection" disabled={running || !selectedKeys.length} onClick={clearSelection}><RotateCcw size={14} /></IconButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
          </div>

          <div className="lorat-stats">
            <StatPill label="visible" value={filteredStats.total} tone="accent" />
            <StatPill label="missing" value={filteredStats.missing} tone={filteredStats.missing ? "bad" : "neutral"} />
            <StatPill label="changed" value={stats.changed} tone={stats.changed ? "good" : "neutral"} />
            <StatPill label="selected" value={stats.selected} tone={stats.selected ? "accent" : "neutral"} />
            <StatPill label="db" value={stats.dbMatched} />
          </div>

          {data.dbOpen ? (
            <TextArea
              label="TriggerDB JSON"
              value={data.triggerDbJson ?? ""}
              disabled={running}
              spellCheck={false}
              onChange={(event) => patch({ triggerDbJson: event.currentTarget.value })}
              className="lorat-db"
            />
          ) : null}

          <ResultView className="lorat-results">
            {running ? <div className="lorat-progress">[{data.progress ?? 0}%] {data.progressText ?? ""}</div> : null}
            {filteredRows.length ? (
              <div className="lorat-list">
                <div className="lorat-head">
                  <span></span><span>LoRA</span><span>Status</span><span>Trigger</span><span>Source</span><span></span>
                </div>
                {filteredRows.slice(0, 160).map((row) => (
                  <LoratRowView
                    key={row.key}
                    row={row}
                    disabled={running}
                    onToggle={() => toggleRow(row)}
                    onChange={(trigger) => editTrigger(row, trigger)}
                    onWrite={() => {
                      void execute("write_triggers", [row.key])
                    }}
                    onNoTrigger={() => {
                      void execute("mark_no_trigger", [row.key])
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="lorat-empty">No rows</div>
            )}
          </ResultView>
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={running ? [`[${data.progress ?? 0}%] ${data.progressText ?? ""}`, ...logs] : logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function LoratRowView(props: {
  row: LoratRow
  disabled: boolean
  onToggle: () => void
  onChange: (trigger: string) => void
  onWrite: () => void
  onNoTrigger: () => void
}) {
  const { row } = props
  return (
    <div className={`lorat-row is-${row.status}${row.changed ? " is-changed" : ""}`}>
      <input className="lorat-check" type="checkbox" checked={Boolean(row.selected)} disabled={props.disabled} onChange={props.onToggle} />
      <div className="lorat-name">
        <div className="lorat-file" title={row.name}>{row.name}</div>
        <div className="lorat-path" title={row.relativeDir || "."}>{row.relativeDir || "."}</div>
      </div>
      <div className="lorat-status">{row.status === "notrigger" ? "none" : row.status}</div>
      <input className="lorat-trigger" value={row.trigger} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} />
      <div className="lorat-source">{row.source}</div>
      <div className="lorat-row-actions">
        <button disabled={props.disabled} title="Write trigger" onClick={props.onWrite}><Tags size={13} /></button>
        <button disabled={props.disabled} title="No trigger" onClick={props.onNoTrigger}><XCircle size={13} /></button>
      </div>
    </div>
  )
}

function actionLabel(action: LoratInput["action"]): string {
  if (action === "scan") return "Scanning"
  if (action === "apply_db") return "Applying TriggerDB"
  if (action === "write_triggers") return "Writing triggers"
  if (action === "mark_no_trigger") return "Writing no-trigger sidecars"
  if (action === "export_db") return "Exporting TriggerDB"
  return "Running"
}

const LORAT_CONTAINER_CSS = `
.lorat-scope {
  container-type: inline-size;
}
.lorat-shell {
  container-type: inline-size;
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  gap: 0.5rem;
}
.lorat-controls {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.45rem;
}
.lorat-select {
  display: grid;
  min-width: 0;
  gap: 0.25rem;
  color: hsl(var(--muted-foreground));
  font-size: 10px;
}
.lorat-select select {
  height: 2rem;
  min-width: 0;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  padding: 0 0.4rem;
  outline: none;
}
.lorat-actions,
.lorat-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.lorat-db {
  min-height: 5.5rem;
  max-height: 10rem;
}
.lorat-results {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.lorat-list {
  display: grid;
  gap: 0.15rem;
}
.lorat-head {
  display: none;
}
.lorat-row {
  display: grid;
  grid-template-columns: 1.35rem minmax(0, 1fr);
  gap: 0.3rem 0.45rem;
  align-items: center;
  border-left: 3px solid hsl(var(--border));
  border-bottom: 1px solid hsl(var(--border) / 0.42);
  padding: 0.38rem 0.25rem 0.38rem 0.35rem;
}
.lorat-row.is-trigger { border-left-color: rgb(34 197 94); }
.lorat-row.is-missing { border-left-color: rgb(245 158 11); }
.lorat-row.is-notrigger { border-left-color: rgb(148 163 184); }
.lorat-row.is-changed { background: hsl(var(--primary) / 0.08); }
.lorat-check {
  width: 1rem;
  height: 1rem;
}
.lorat-name {
  min-width: 0;
}
.lorat-file,
.lorat-path,
.lorat-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lorat-file {
  color: hsl(var(--foreground));
  font-weight: 650;
}
.lorat-path,
.lorat-source {
  color: hsl(var(--muted-foreground));
  font-size: 10px;
}
.lorat-status {
  width: fit-content;
  border: 1px solid hsl(var(--border));
  padding: 0.13rem 0.38rem;
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 700;
}
.lorat-trigger {
  min-width: 0;
  height: 1.9rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  padding: 0 0.45rem;
  outline: none;
}
.lorat-status,
.lorat-trigger,
.lorat-source,
.lorat-row-actions {
  grid-column: 2;
}
.lorat-row-actions {
  display: flex;
  gap: 0.25rem;
}
.lorat-row-actions button {
  display: inline-flex;
  height: 1.75rem;
  width: 1.75rem;
  align-items: center;
  justify-content: center;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
}
.lorat-empty,
.lorat-progress {
  color: hsl(var(--muted-foreground));
  padding: 0.75rem 0;
  text-align: center;
}
@container (min-width: 30rem) {
  .lorat-controls {
    grid-template-columns: minmax(12rem, 1.5fr) minmax(8rem, 1fr) 6rem 5.5rem;
    align-items: end;
  }
  .lorat-db {
    min-height: 4.5rem;
  }
  .lorat-row {
    grid-template-columns: 1.35rem minmax(12rem, 1.5fr) 5.5rem minmax(10rem, 1fr);
  }
  .lorat-status,
  .lorat-trigger {
    grid-column: auto;
  }
  .lorat-source,
  .lorat-row-actions {
    grid-column: 4;
  }
}
@container (min-width: 48rem) {
  .lorat-shell {
    gap: 0.6rem;
  }
  .lorat-head,
  .lorat-row {
    display: grid;
    grid-template-columns: 1.35rem minmax(13rem, 1.45fr) 5.8rem minmax(12rem, 1fr) 5.2rem 4.2rem;
    gap: 0.55rem;
    align-items: center;
  }
  .lorat-head {
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--background));
    color: hsl(var(--muted-foreground));
    font-size: 10px;
    font-weight: 750;
    padding: 0.25rem 0.35rem;
    text-transform: uppercase;
  }
  .lorat-row {
    min-height: 2.8rem;
    padding: 0.35rem;
  }
  .lorat-status,
  .lorat-trigger,
  .lorat-source,
  .lorat-row-actions {
    grid-column: auto;
  }
  .lorat-row-actions {
    justify-content: flex-end;
  }
}
@container (min-width: 66rem) {
  .lorat-controls {
    grid-template-columns: minmax(18rem, 1.8fr) minmax(12rem, 1fr) 7rem 6rem;
  }
  .lorat-head,
  .lorat-row {
    grid-template-columns: 1.35rem minmax(18rem, 1.7fr) 6rem minmax(18rem, 1.25fr) 6rem 4.5rem;
  }
}
`
