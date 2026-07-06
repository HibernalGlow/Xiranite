import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Download, FileDown, FileUp, Play, RefreshCw, RotateCcw, ShieldCheck, Square, UploadCloud } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNativeAction } from "@xiranite/ui"
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
  const { t } = useTranslation()
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
    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for network and filesystem actions.")
    const input = buildInput(action, data)
    if (action === "crawl" && !input.userIds && !data.configPath) return

    setRunning(true)
    patch({ phase: action, progress: 0, progressText: t("module:weibospider.starting") })
    const response = await runNativeAction<WeiboSpiderInput, WeiboSpiderData>("weibospider", input, (event) => {
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
        title={t("module:weibospider.title")}
        meta={t("module:weibospider.meta", {
          users: result?.crawledUsers ?? 0,
          weibos: result?.crawledWeibos ?? 0,
          cookie: cookieState.valid ? t("module:weibospider.cookieReadyMeta") : t("module:weibospider.cookiePendingMeta"),
        })}
        actions={
          <>
            <IconButton title={t("module:weibospider.pasteUsers")} disabled={running} onClick={pasteUsers}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running} onClick={() => execute("load_config")}><RefreshCw size={14} /> {t("module:weibospider.load")}</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("save_config")}><UploadCloud size={14} /> {t("module:weibospider.save")}</ActionButton>
            <ActionButton disabled={running || !data.cookie} onClick={() => execute("validate_cookie")}><ShieldCheck size={14} /> {t("module:weibospider.cookie")}</ActionButton>
            <ActionButton variant="primary" disabled={running || (!data.userText && !data.configPath)} onClick={() => execute("crawl")}><Play size={14} /> {t("module:weibospider.crawl")}</ActionButton>
            <IconButton title={t("module:weibospider.copySummary")} onClick={copySummary}><Copy size={14} /></IconButton>
            <IconButton title={t("module:weibospider.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:weibospider.users")} value={data.userText ?? ""} disabled={running} placeholder="1669879400, 123456" onChange={(event) => patch({ userText: event.currentTarget.value })} />
          <Field label={t("module:weibospider.since")} value={data.sinceDate ?? ""} disabled={running} placeholder="2024-01-01" onChange={(event) => patch({ sinceDate: event.currentTarget.value })} />
          <Field label={t("module:weibospider.end")} value={data.endDate ?? "now"} disabled={running} placeholder="now" onChange={(event) => patch({ endDate: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:weibospider.outputDir")} value={data.outputDir ?? ""} disabled={running} onChange={(event) => patch({ outputDir: event.currentTarget.value })} />
          <Field label={t("module:weibospider.configPath")} value={data.configPath ?? ""} disabled={running} onChange={(event) => patch({ configPath: event.currentTarget.value })} />
          <Field label={t("module:weibospider.maxPages")} type="number" value={data.maxPages ?? 0} disabled={running} onChange={(event) => patch({ maxPages: Number(event.currentTarget.value) })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={data.filterOriginal ?? true} disabled={running} onClick={() => patch({ filterOriginal: !(data.filterOriginal ?? true) })}>{t("module:weibospider.original")}</SegmentButton>
          <SegmentButton active={data.picDownload ?? true} disabled={running} onClick={() => patch({ picDownload: !(data.picDownload ?? true) })}>{t("module:weibospider.pictures")}</SegmentButton>
          <SegmentButton active={data.videoDownload ?? true} disabled={running} onClick={() => patch({ videoDownload: !(data.videoDownload ?? true) })}>{t("module:weibospider.videos")}</SegmentButton>
          <SegmentButton active={data.downloadMedia ?? false} disabled={running} onClick={() => patch({ downloadMedia: !(data.downloadMedia ?? false) })}>{t("module:weibospider.download")}</SegmentButton>
          <SegmentButton active={(data.browser ?? "edge") === "edge"} disabled={running} onClick={() => patch({ browser: "edge" })}>{t("module:weibospider.edge")}</SegmentButton>
          <SegmentButton active={data.browser === "chrome"} disabled={running} onClick={() => patch({ browser: "chrome" })}>{t("module:weibospider.chrome")}</SegmentButton>
          <ActionButton disabled={running} onClick={() => execute("get_browser_cookie")}><Download size={14} /> {t("module:weibospider.browser")}</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label={t("module:weibospider.writeMode")} value={data.writeMode ?? "json"} disabled={running} placeholder="json,csv,txt" onChange={(event) => patch({ writeMode: event.currentTarget.value })} />
          <Field label={t("module:weibospider.importPath")} value={data.importPath ?? ""} disabled={running} onChange={(event) => patch({ importPath: event.currentTarget.value })} />
          <Field label={t("module:weibospider.exportPath")} value={data.exportPath ?? ""} disabled={running} onChange={(event) => patch({ exportPath: event.currentTarget.value })} />
          <ActionButton disabled={running || !data.importPath} onClick={() => execute("import_config")}><FileUp size={14} /> {t("module:weibospider.import")}</ActionButton>
          <ActionButton disabled={running || !data.exportPath} onClick={() => execute("export_config")}><FileDown size={14} /> {t("module:weibospider.export")}</ActionButton>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:weibospider.statCookie")} value={cookieState.valid ? t("module:weibospider.ready") : t("module:weibospider.missing")} tone={cookieState.valid ? "good" : "bad"} />
          <StatPill label={t("module:weibospider.statUsers")} value={result?.crawledUsers ?? 0} tone="accent" />
          <StatPill label={t("module:weibospider.statWeibos")} value={result?.crawledWeibos ?? 0} tone="good" />
          <StatPill label={t("module:weibospider.statWrites")} value={result?.outputPaths.length ?? 0} />
          <StatPill label={t("module:weibospider.statErrors")} value={result?.errors.length ?? 0} tone={(result?.errors.length ?? 0) ? "bad" : "neutral"} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label={t("module:weibospider.cookieLabel")}
            value={data.cookie ?? ""}
            disabled={running}
            placeholder={'SUB=...; ALF=... or {"cookie":"..."}'}
            spellCheck={false}
            onChange={(event) => patch({ cookie: parseCookieInput(event.currentTarget.value) })}
          />
          <div className="flex shrink-0 flex-wrap gap-1">
            <ActionButton disabled={running} onClick={pasteCookie}><Clipboard size={14} /> {t("module:weibospider.pasteCookie")}</ActionButton>
            <ActionButton disabled={running} onClick={() => patch({ cookie: "" })}><Square size={14} /> {t("module:weibospider.clear")}</ActionButton>
            <IconButton title={t("module:weibospider.copyLogs")} onClick={copyLogs}><Copy size={14} /></IconButton>
          </div>
          <ResultView className="flex-1 text-muted-foreground">
            {running ? (
              <div>{t("module:weibospider.progressLine", { progress: data.progress ?? 0, text: data.progressText ?? "" })}</div>
            ) : result?.posts.length ? (
              result.posts.slice(0, 80).map((item) => (
                <div key={item.id} className="truncate">{t("module:weibospider.postLine", { time: item.publish_time, type: t(item.original ? "module:weibospider.original" : "module:weibospider.retweet"), content: item.content })}</div>
              ))
            ) : result?.outputPaths.length ? (
              result.outputPaths.map((path) => <div key={path} className="truncate">{t("module:weibospider.writePath", { path })}</div>)
            ) : result?.errors.length ? (
              result.errors.map((item) => <div key={item} className="truncate">{t("module:weibospider.errorItem", { item })}</div>)
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">{t("module:weibospider.readyToCrawl")}</div>
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
