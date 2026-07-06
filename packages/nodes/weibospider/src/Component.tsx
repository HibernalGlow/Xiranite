import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Download, FileDown, FileUp, Play, RefreshCw, RotateCcw, ShieldCheck, Square, UploadCloud } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea } from "@xiranite/ui"
import type { WeiboSpiderAction, WeiboSpiderData, WeiboSpiderInput, WeiboSpiderResult } from "./core.js"
import { parseCookieInput, validateCookieFields } from "./core.js"

interface WeiboSpiderCardState {
  userText?: string
  sinceDate?: string
  endDate?: string
  outputDir?: string
  configPath?: string
  importPath?: string
  exportPath?: string
  cookie?: string
  browser?: "edge" | "chrome" | "firefox"
  writeMode?: string
  maxPages?: number
  filterOriginal?: boolean
  picDownload?: boolean
  videoDownload?: boolean
  downloadMedia?: boolean
  phase?: string
  progress?: number
  progressText?: string
  result?: WeiboSpiderData | null
  logs?: string[]
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<WeiboSpiderCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const result = data.result ?? null
  const cookieState = validateCookieFields(parseCookieInput(data.cookie ?? ""))

  function patch(patchData: Partial<WeiboSpiderCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-50), message] })
  }

  async function pasteCookie() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ cookie: parseCookieInput(text) })
  }

  async function pasteUsers() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ userText: text.trim() })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  async function copySummary() {
    const lines = [
      result?.configPath ? `config=${result.configPath}` : "",
      result?.outputDir ? `output=${result.outputDir}` : "",
      `users=${result?.crawledUsers ?? 0}`,
      `weibos=${result?.crawledWeibos ?? 0}`,
      ...(result?.outputPaths ?? []),
    ].filter(Boolean)
    await host.clipboard?.writeText?.(lines.join("\n"))
  }

  async function execute(action: WeiboSpiderAction) {
    if (running) return
    const runNode = host.runner?.runNode
    if (!runNode) {
      log("Host runner unavailable. Use the xiranite-weibospider CLI for network and filesystem actions.")
      return
    }
    const input = buildInput(action, data)
    if (action === "crawl" && !input.userIds && !data.configPath) return

    setRunning(true)
    patch({ phase: action, progress: 0, progressText: "starting" })
    const response = await runNode<WeiboSpiderInput, WeiboSpiderData>("weibospider", input, (event) => {
      if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      else log(event.message)
    }) as WeiboSpiderResult

    const next = response.data ?? null
    patch({
      phase: response.success ? "completed" : "error",
      progress: response.success ? 100 : 0,
      progressText: response.message,
      result: next,
      outputDir: next?.outputDir || data.outputDir,
      configPath: next?.configPath || data.configPath,
    })
    log(response.message)
    setRunning(false)
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  return (
    <NodeContent>
      <NodeHeader
        title="weibospider"
        meta={`${result?.crawledUsers ?? 0} users / ${result?.crawledWeibos ?? 0} weibos / ${cookieState.valid ? "cookie ready" : "cookie pending"}`}
        actions={
          <>
            <IconButton title="Paste users" disabled={running} onClick={pasteUsers}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running} onClick={() => execute("load_config")}><RefreshCw size={14} /> Load</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("save_config")}><UploadCloud size={14} /> Save</ActionButton>
            <ActionButton disabled={running || !data.cookie} onClick={() => execute("validate_cookie")}><ShieldCheck size={14} /> Cookie</ActionButton>
            <ActionButton variant="primary" disabled={running || (!data.userText && !data.configPath)} onClick={() => execute("crawl")}><Play size={14} /> Crawl</ActionButton>
            <IconButton title="Copy summary" onClick={copySummary}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="users" value={data.userText ?? ""} disabled={running} placeholder="1669879400, 123456" onChange={(event) => patch({ userText: event.currentTarget.value })} />
          <Field label="since" value={data.sinceDate ?? ""} disabled={running} placeholder="2024-01-01" onChange={(event) => patch({ sinceDate: event.currentTarget.value })} />
          <Field label="end" value={data.endDate ?? "now"} disabled={running} placeholder="now" onChange={(event) => patch({ endDate: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="output dir" value={data.outputDir ?? ""} disabled={running} onChange={(event) => patch({ outputDir: event.currentTarget.value })} />
          <Field label="config path" value={data.configPath ?? ""} disabled={running} onChange={(event) => patch({ configPath: event.currentTarget.value })} />
          <Field label="max pages" type="number" value={data.maxPages ?? 0} disabled={running} onChange={(event) => patch({ maxPages: Number(event.currentTarget.value) })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.filterOriginal ?? true} disabled={running} onClick={() => patch({ filterOriginal: !(data.filterOriginal ?? true) })}>original</SegmentButton>
          <SegmentButton active={data.picDownload ?? true} disabled={running} onClick={() => patch({ picDownload: !(data.picDownload ?? true) })}>pictures</SegmentButton>
          <SegmentButton active={data.videoDownload ?? true} disabled={running} onClick={() => patch({ videoDownload: !(data.videoDownload ?? true) })}>videos</SegmentButton>
          <SegmentButton active={data.downloadMedia ?? false} disabled={running} onClick={() => patch({ downloadMedia: !(data.downloadMedia ?? false) })}>download</SegmentButton>
          <SegmentButton active={(data.browser ?? "edge") === "edge"} disabled={running} onClick={() => patch({ browser: "edge" })}>edge</SegmentButton>
          <SegmentButton active={data.browser === "chrome"} disabled={running} onClick={() => patch({ browser: "chrome" })}>chrome</SegmentButton>
          <ActionButton disabled={running} onClick={() => execute("get_browser_cookie")}><Download size={14} /> Browser</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="write mode" value={data.writeMode ?? "json"} disabled={running} placeholder="json,csv,txt" onChange={(event) => patch({ writeMode: event.currentTarget.value })} />
          <Field label="import path" value={data.importPath ?? ""} disabled={running} onChange={(event) => patch({ importPath: event.currentTarget.value })} />
          <Field label="export path" value={data.exportPath ?? ""} disabled={running} onChange={(event) => patch({ exportPath: event.currentTarget.value })} />
          <ActionButton disabled={running || !data.importPath} onClick={() => execute("import_config")}><FileUp size={14} /> Import</ActionButton>
          <ActionButton disabled={running || !data.exportPath} onClick={() => execute("export_config")}><FileDown size={14} /> Export</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="cookie" value={cookieState.valid ? "ready" : "missing"} tone={cookieState.valid ? "good" : "bad"} />
          <StatPill label="users" value={result?.crawledUsers ?? 0} tone="accent" />
          <StatPill label="weibos" value={result?.crawledWeibos ?? 0} tone="good" />
          <StatPill label="writes" value={result?.outputPaths.length ?? 0} />
          <StatPill label="errors" value={result?.errors.length ?? 0} tone={(result?.errors.length ?? 0) ? "bad" : "neutral"} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label="cookie"
            value={data.cookie ?? ""}
            disabled={running}
            placeholder={'SUB=...; ALF=... or {"cookie":"..."}'}
            spellCheck={false}
            onChange={(event) => patch({ cookie: parseCookieInput(event.currentTarget.value) })}
          />
          <div className="flex shrink-0 flex-wrap gap-1">
            <ActionButton disabled={running} onClick={pasteCookie}><Clipboard size={14} /> Paste cookie</ActionButton>
            <ActionButton disabled={running} onClick={() => patch({ cookie: "" })}><Square size={14} /> Clear</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
          </div>
          <ResultView className="flex-1 text-muted-foreground">
            {running ? (
              <div>{`[${data.progress ?? 0}%] ${data.progressText ?? ""}`}</div>
            ) : result?.posts.length ? (
              result.posts.slice(0, 80).map((item) => (
                <div key={item.id} className="truncate">{item.publish_time} / {item.original ? "original" : "retweet"} / {item.content}</div>
              ))
            ) : result?.outputPaths.length ? (
              result.outputPaths.map((path) => <div key={path} className="truncate">write {path}</div>)
            ) : result?.errors.length ? (
              result.errors.map((item) => <div key={item} className="truncate">error {item}</div>)
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">Ready to crawl weibo.cn users.</div>
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

function buildInput(action: WeiboSpiderAction, data: WeiboSpiderCardState): WeiboSpiderInput {
  return {
    action,
    userIds: data.userText,
    filterOriginal: data.filterOriginal ?? true,
    sinceDate: data.sinceDate,
    endDate: data.endDate || "now",
    picDownload: data.picDownload ?? true,
    videoDownload: data.videoDownload ?? true,
    writeMode: data.writeMode || "json",
    outputDir: data.outputDir,
    cookie: data.cookie,
    browser: data.browser ?? "edge",
    configPath: data.configPath,
    importPath: data.importPath,
    exportPath: data.exportPath,
    maxPages: data.maxPages,
    downloadMedia: data.downloadMedia ?? false,
  }
}
