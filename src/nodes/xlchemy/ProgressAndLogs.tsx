import { useEffect, useMemo, useRef, useState } from "react"
import { Activity, Check, Clock, Copy, Search, Timer, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { XlchemyData } from "@xiranite/node-xlchemy/core"
import type { XlchemyCardState, XlchemyPhase } from "./types"

type LogLevel = "info" | "warn" | "error" | "success"
type LogEntry = { time: string; level: LogLevel; message: string }
const LEVELS: Array<{ value: LogLevel; label: string; className: string }> = [
  { value: "info", label: "INF", className: "text-chart-2" },
  { value: "warn", label: "WRN", className: "text-chart-4" },
  { value: "error", label: "ERR", className: "text-destructive" },
  { value: "success", label: "OK", className: "text-primary" },
]

export function WorkbenchTelemetry(props: { format: string; phase: XlchemyPhase; progress: number; result: XlchemyData | null; running: boolean; threads: number }) {
  const errorCount = props.result?.errorCount ?? (props.phase === "error" ? 1 : 0)
  const activity = props.running ? Math.max(0.28, props.progress / 100) : props.result ? 0.55 : 0.14
  const wave = telemetryWave(activity, errorCount, props.progress)
  const converted = props.result?.convertedCount ?? 0
  const status = props.running ? "engaged" : props.phase === "error" ? "fault" : props.phase === "completed" ? "complete" : "standby"
  const tone = props.phase === "error" ? "text-destructive" : props.running || props.phase === "completed" ? "text-chart-2" : "text-muted-foreground"
  return <div className={cn("relative isolate h-20 overflow-hidden rounded-md border bg-muted/30 px-3 py-2 transition-colors duration-500", tone)} data-state={status} data-testid="xlchemy-telemetry">
    <svg aria-hidden="true" className="absolute inset-x-0 top-0 h-12 w-full opacity-45" preserveAspectRatio="none" viewBox="0 0 200 40">
      <line x1="0" x2="200" y1="20" y2="20" stroke="currentColor" strokeDasharray="2 6" strokeWidth=".3" opacity=".18" />
      <g className="xlchemy-matrix-wave" style={{ animationDuration: `${Math.max(2.8, 8 - activity * 4.5)}s` }}>
        <path d={`${wave} L200 40 L0 40 Z`} fill="currentColor" opacity=".06" />
        <path d={`${wave} L200 40 L0 40 Z`} fill="currentColor" opacity=".06" transform="translate(200 0)" />
        <path d={wave} fill="none" opacity=".18" stroke="currentColor" strokeWidth={2.4 + activity} vectorEffect="non-scaling-stroke" />
        <path d={wave} fill="none" opacity=".18" stroke="currentColor" strokeWidth={2.4 + activity} transform="translate(200 0)" vectorEffect="non-scaling-stroke" />
        <path d={wave} fill="none" stroke="currentColor" strokeWidth={0.7 + activity * 0.45} vectorEffect="non-scaling-stroke" />
        <path d={wave} fill="none" stroke="currentColor" strokeWidth={0.7 + activity * 0.45} transform="translate(200 0)" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-muted/80 to-transparent" />
    <div className="relative flex h-full items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em]"><Activity /><span>Core matrix</span><span className={cn("size-1.5 rounded-full bg-current", props.running && "animate-pulse motion-reduce:animate-none")} /></div>
        <div className="mt-1 truncate text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Xlchemy workstation · {props.format}</div>
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-3 text-right font-mono text-[9px] uppercase text-muted-foreground"><div><div>Load</div><div className={cn("mt-0.5 text-sm font-semibold", tone)}>{props.progress}%</div></div><div><div>Done</div><div className={cn("mt-0.5 text-sm font-semibold", tone)}>{converted}</div></div><div><div>Threads</div><div className={cn("mt-0.5 text-sm font-semibold", tone)}>{props.threads}</div></div></div>
    </div>
    <span aria-hidden="true" className="absolute left-1 top-1 size-2 border-l border-t border-current opacity-50" /><span aria-hidden="true" className="absolute right-1 top-1 size-2 border-r border-t border-current opacity-50" /><span aria-hidden="true" className="absolute bottom-1 left-1 size-2 border-b border-l border-current opacity-50" /><span aria-hidden="true" className="absolute bottom-1 right-1 size-2 border-b border-r border-current opacity-50" />
  </div>
}

function telemetryWave(activity: number, errors: number, progress: number): string {
  const amplitude = 8 + activity * 8 + Math.min(errors, 3) * 1.4
  const modulation = 1 + (progress / 100) * 0.16
  const profile = [
    [0, 0], [15, -0.08], [31, 0.12], [47, -0.68], [63, 0.82], [79, -0.31], [94, 0.18],
    [109, -0.9], [124, 0.96], [139, -0.22], [154, 0.58], [170, -0.76], [185, 0.36], [200, 0],
  ].map(([x, level], index) => ({ x, y: 20 + level * amplitude * (index % 3 === 0 ? modulation : 1) }))
  let path = `M${profile[0]!.x} ${profile[0]!.y.toFixed(2)}`
  for (let index = 0; index < profile.length - 1; index += 1) {
    const p0 = index === 0 ? { x: profile.at(-2)!.x - 200, y: profile.at(-2)!.y } : profile[index - 1]!
    const p1 = profile[index]!, p2 = profile[index + 1]!
    const p3 = index + 2 < profile.length ? profile[index + 2]! : { x: profile[1]!.x + 200, y: profile[1]!.y }
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6
    path += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x} ${p2.y.toFixed(2)}`
  }
  return path
}

export function ProgressWorkbench(props: { data: XlchemyCardState; format: string; paths: string[]; progress: number; result: XlchemyData | null; running: boolean; onPatch: (patch: Partial<XlchemyCardState>) => void }) {
  const [startedAt, setStartedAt] = useState(() => Date.now()), [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!props.running) return; setStartedAt(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(timer) }, [props.running])
  const elapsedMs = props.running ? now - startedAt : props.result?.elapsedMs ?? 0, total = props.result?.inputCount ?? props.paths.length, completed = props.result?.convertedCount ?? Math.round(total * props.progress / 100)
  const etaMs = props.running && completed > 0 ? elapsedMs / completed * Math.max(0, total - completed) : 0, speed = elapsedMs > 0 && completed > 0 ? completed / (elapsedMs / 1000) : 0
  const showCounter = props.data.showProgressCounter ?? true, showSummary = props.data.showProgressSummary ?? true, showEta = props.data.showProgressEta ?? true, showFormat = props.data.showProgressFormat ?? true, showEncoder = props.data.showProgressEncoder ?? true, showCurrentFile = props.data.showProgressCurrentFile ?? true, showSizeChange = props.data.showProgressSizeChange ?? true
  const encoder = props.format === "JPEG XL" ? "cjxl" : props.format === "AVIF" ? props.data.avifEncoder === "svt" ? "SVT-AV1" : "AOM AV1" : props.format === "JPEG" ? props.data.jpegEncoder === "libjpeg" ? "libjpeg" : "JPEGLI" : props.format
  return <div className="flex flex-col gap-3" data-testid="xlchemy-progress-workbench"><div className="rounded-md border bg-card p-3"><div className="mb-3 flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">运行状态</div><div className="mt-1 text-sm font-semibold">{props.running ? "转换进行中" : total > 0 ? "最近一次转换已完成" : "等待开始"}</div></div><Badge variant={props.running ? "default" : total > 0 ? "secondary" : "outline"}>{props.running ? "运行中" : total > 0 ? "已完成" : "待机"}</Badge></div><Progress value={props.progress} /><div className="mt-3 grid grid-cols-3 gap-2">{showCounter && <Stat label="进度" value={`${completed}/${total}`} />}<Stat label="已用时间" value={formatDuration(elapsedMs)} />{showEta && <Stat label="ETA" value={props.running ? formatDuration(etaMs) : "--:--"} />}</div></div>{(props.running || elapsedMs > 0) && <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-[11px] tabular-nums text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock className="size-3" /><span className="text-foreground">{formatDuration(elapsedMs)}</span></span>{props.running && completed > 0 && <>{showEta && <span className="inline-flex items-center gap-1"><Timer className="size-3" />ETA {formatDuration(etaMs)}</span>}<span>{speed >= 1 ? `${speed.toFixed(1)}/s` : `${(speed * 60).toFixed(1)}/min`}</span></>}<span className="ml-auto">{props.progress}%</span></div>}{props.data.currentFile && (showCurrentFile || showSizeChange) && <div className="rounded-md border bg-card px-3 py-2">{showCurrentFile && <div className="truncate text-xs font-medium">{props.data.currentFile}</div>}{showSizeChange && <div className="mt-1 text-[11px] text-muted-foreground">{props.data.progressText}</div>}</div>}{showSummary && <div className="text-xs leading-5 text-muted-foreground">{props.data.progressText || "添加文件后，这里会显示当前进度、耗时、ETA 和输出摘要。"}</div>}{(showCounter || showFormat || showEncoder) && <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">{showCounter && <Badge variant="outline">{completed}/{total}</Badge>}{showFormat && <Badge variant="outline">{props.format}</Badge>}{showEncoder && <Badge variant="outline">{encoder}</Badge>}</div>}{props.data.showRawProgress !== false && <div className="rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] text-muted-foreground"><div>{props.data.progressText || "—"}</div><div>{props.result ? `${props.result.outputBytes} bytes · ${props.result.errorCount} errors` : "—"}</div></div>}<div className="grid grid-cols-2 gap-2 rounded-md border bg-card p-3 text-[11px] @sm/xlchemy:grid-cols-4"><Option checked={showCounter} label="计数" onChange={(showProgressCounter) => props.onPatch({ showProgressCounter })} /><Option checked={showSummary} label="摘要" onChange={(showProgressSummary) => props.onPatch({ showProgressSummary })} /><Option checked={showEta} label="ETA" onChange={(showProgressEta) => props.onPatch({ showProgressEta })} /><Option checked={showFormat} label="格式" onChange={(showProgressFormat) => props.onPatch({ showProgressFormat })} /><Option checked={showEncoder} label="编码器" onChange={(showProgressEncoder) => props.onPatch({ showProgressEncoder })} /><Option checked={showCurrentFile} label="当前文件" onChange={(showProgressCurrentFile) => props.onPatch({ showProgressCurrentFile })} /><Option checked={showSizeChange} label="大小变化" onChange={(showProgressSizeChange) => props.onPatch({ showProgressSizeChange })} /><Option checked={props.data.showRawProgress ?? true} label="原始日志" onChange={(showRawProgress) => props.onPatch({ showRawProgress })} /></div></div>
}

export function ConversionLog(props: { logs: string[]; onClear: () => void; onCopy: (text: string) => void }) {
  const [query, setQuery] = useState(""), [levels, setLevels] = useState<LogLevel[]>(["info", "warn", "error", "success"]), [autoScroll, setAutoScroll] = useState(true), [copied, setCopied] = useState(false)
  const bottom = useRef<HTMLDivElement>(null), entries = useMemo(() => props.logs.map(parseLog), [props.logs]), filtered = entries.filter((entry) => levels.includes(entry.level) && (!query.trim() || entry.message.toLowerCase().includes(query.trim().toLowerCase())))
  useEffect(() => { if (autoScroll) bottom.current?.scrollIntoView({ block: "end" }) }, [autoScroll, filtered.length])
  async function copy() { props.onCopy(filtered.map((entry) => `[${entry.time}] [${entry.level.toUpperCase()}] ${entry.message}`).join("\n")); setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
  return <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden" data-testid="xlchemy-conversion-log"><div className="flex flex-wrap items-center gap-1"><div className="relative min-w-28 flex-1"><Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索日志" className="h-7 pl-6 text-[11px]" value={query} placeholder="搜索日志…" onChange={(event) => setQuery(event.currentTarget.value)} /></div><ToggleGroup type="multiple" value={levels} size="sm" variant="outline" spacing={1} onValueChange={(values) => setLevels(values as LogLevel[])}>{LEVELS.map((level) => <ToggleGroupItem key={level.value} value={level.value} aria-label={`过滤 ${level.label}`} className={cn("h-7 px-1.5 text-[9px] font-bold data-[state=off]:opacity-40 data-[state=on]:border-current data-[state=on]:bg-transparent", level.className)}>{level.label}</ToggleGroupItem>)}</ToggleGroup><Button aria-label="复制日志" size="icon-sm" variant="ghost" onClick={() => void copy()}>{copied ? <Check className="text-primary" /> : <Copy />}</Button><Button aria-label="清空日志" size="icon-sm" variant="ghost" onClick={props.onClear}><Trash2 /></Button></div><ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/30" data-testid="xlchemy-conversion-log-scroll"><div className="min-h-full py-1 font-mono text-[10px] leading-relaxed">{filtered.length ? filtered.map((entry, index) => <div key={`${entry.time}-${index}`} className="grid grid-cols-[4.5rem_2rem_minmax(0,1fr)] items-start gap-1.5 px-2 py-0.5 hover:bg-muted/50"><span className="tabular-nums text-muted-foreground">{entry.time}</span><span className={cn("font-bold", LEVELS.find((level) => level.value === entry.level)?.className)}>{LEVELS.find((level) => level.value === entry.level)?.label}</span><span className="min-w-0 break-all text-foreground">{entry.message}</span></div>) : <div className="grid min-h-20 place-items-center text-muted-foreground">{entries.length ? "没有匹配日志" : "暂无日志"}</div>}<div ref={bottom} /></div></ScrollArea><div className="flex shrink-0 items-center justify-between text-[10px] text-muted-foreground"><span>{filtered.length} / {entries.length} 条</span><label className="flex cursor-pointer items-center gap-1"><Checkbox checked={autoScroll} onCheckedChange={(value) => setAutoScroll(value === true)} />自动滚动</label></div></div>
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-md border bg-muted/30 px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold tabular-nums">{value}</div></div> }
function Option({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) { return <label className="flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />{label}</label> }
function parseLog(line: string, index: number): LogEntry { const lower = line.toLowerCase(), level: LogLevel = /error|failed|失败|错误/.test(lower) ? "error" : /warn|skip|警告|跳过/.test(lower) ? "warn" : /success|complete|完成|converted/.test(lower) ? "success" : "info"; return { time: /^\d\d:\d\d:\d\d/.exec(line)?.[0] ?? new Date(index * 1000).toISOString().slice(11, 19), level, message: line.replace(/^\d\d:\d\d:\d\d\s*/, "") } }
function formatDuration(ms: number) { if (!ms || ms < 0) return "00:00"; const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` }
