import type { VertFormatCategory } from "@xiranite/node-vert/core"
import { VERT_FORMAT_GROUPS } from "@xiranite/node-vert/core"
import { FileAudio, FileImage, FileText, FileVideo, Route } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { VertConversionGroupConfig, VertOutputCategory } from "./types"

export interface VertInputFileGroup {
  key: string
  extension: string
  category: VertFormatCategory
  paths: string[]
  files: File[]
}

export interface VertConversionRoute {
  group: VertInputFileGroup
  config: VertConversionGroupConfig
}

const CATEGORY_ORDER: VertOutputCategory[] = ["image", "video", "audio", "document"]
const CATEGORY_META = {
  image: { label: "图片", icon: FileImage, className: "border-chart-1/40 bg-chart-1/10 text-chart-1" },
  video: { label: "视频", icon: FileVideo, className: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  audio: { label: "音频", icon: FileAudio, className: "border-chart-3/40 bg-chart-3/10 text-chart-3" },
  document: { label: "文档", icon: FileText, className: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
} as const

export function ConversionTopology(props: { compact?: boolean; dense?: boolean; routes: VertConversionRoute[]; onChange: (key: string, config: VertConversionGroupConfig) => void }) {
  if (!props.routes.length) return <TopologyEmpty compact={props.compact} />
  if (props.compact) return <CompactTopology {...props} />
  const routeCount = props.routes.length
  return <section className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-background/55 p-3" data-testid="vert-conversion-topology">
    <div className="mb-3 flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold">转换拓扑</h4><p className="text-xs text-muted-foreground">文件按输入格式成团；每团只连接一个转换组。</p></div><Badge variant="secondary">{routeCount} 个转换组</Badge></div>
    <div className="relative min-h-[330px]">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 1000 1000">
        {props.routes.map((route, index) => {
          const rowY = ((index + 0.5) / routeCount) * 1000
          const categoryIndex = Math.max(0, CATEGORY_ORDER.indexOf(route.group.category === "unknown" ? "document" : route.group.category))
          const categoryY = ((categoryIndex + 0.5) / CATEGORY_ORDER.length) * 1000
          return <g key={route.group.key} className="text-primary/55"><path d={`M 275 ${rowY} C 350 ${rowY}, 365 ${categoryY}, 455 ${categoryY}`} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /><path d={`M 545 ${categoryY} C 635 ${categoryY}, 650 ${rowY}, 725 ${rowY}`} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /><circle cx="275" cy={rowY} fill="currentColor" r="5" vectorEffect="non-scaling-stroke" /><circle cx="725" cy={rowY} fill="currentColor" r="5" vectorEffect="non-scaling-stroke" /></g>
        })}
      </svg>
      <div className="relative grid min-h-[330px] grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] gap-x-20">
        <div className="grid gap-2" style={{ gridTemplateRows: `repeat(${routeCount}, minmax(0, 1fr))` }}>{props.routes.map((route) => <SourceGroupCard key={route.group.key} group={route.group} />)}</div>
        <div className="grid grid-rows-4 gap-2">{CATEGORY_ORDER.map((category) => <CategoryRouter key={category} category={category} active={props.routes.some((route) => route.group.category === category)} />)}</div>
        <div className="grid gap-2" style={{ gridTemplateRows: `repeat(${routeCount}, minmax(0, 1fr))` }}>{props.routes.map((route) => <OutputGroupCard key={route.group.key} route={route} onChange={props.onChange} />)}</div>
      </div>
    </div>
  </section>
}

function SourceGroupCard({ group }: { group: VertInputFileGroup }) {
  const category = group.category === "unknown" ? "document" : group.category
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  const total = group.paths.length + group.files.length
  const examples = [...group.paths.map(fileName), ...group.files.map((file) => file.name)].slice(0, 2)
  return <article className="flex min-h-0 items-center gap-3 rounded-xl border bg-card/90 px-3 py-2 shadow-sm"><div className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", meta.className)}><Icon /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-sm font-semibold uppercase">.{group.extension}</span><Badge variant="outline">{total} 个</Badge></div><p className="truncate text-[11px] text-muted-foreground" title={examples.join(" · ")}>{examples.join(" · ")}</p></div><Badge variant="secondary">文件团</Badge></article>
}

function CategoryRouter({ active, category }: { active: boolean; category: VertOutputCategory }) {
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  return <div className={cn("relative flex flex-col items-center justify-center rounded-xl border px-2 text-center transition-opacity", meta.className, !active && "opacity-35")}><Icon className="mb-1 size-5" /><span className="text-xs font-semibold">{meta.label}</span><span className="text-[10px] opacity-70">自动路由</span>{active ? <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-primary ring-2 ring-background" /> : null}</div>
}

function OutputGroupCard({ onChange, route }: { onChange: (key: string, config: VertConversionGroupConfig) => void; route: VertConversionRoute }) {
  return <article className="flex min-h-0 flex-col justify-center gap-2 rounded-xl border bg-card/90 px-3 py-2 shadow-sm"><div className="flex items-center gap-2"><Route className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold uppercase">.{route.group.extension} → .{route.config.targetFormat}</span><Badge variant="outline">转换组</Badge></div><div className="grid grid-cols-2 gap-2"><CategorySelect group={route.group} value={route.config.outputCategory} onChange={(outputCategory) => onChange(route.group.key, { outputCategory, targetFormat: defaultFormat(outputCategory) })} /><FormatSelect category={route.config.outputCategory} value={route.config.targetFormat} onChange={(targetFormat) => onChange(route.group.key, { ...route.config, targetFormat })} /></div></article>
}

function CompactTopology(props: { dense?: boolean; routes: VertConversionRoute[]; onChange: (key: string, config: VertConversionGroupConfig) => void }) {
  if (props.dense) return <section className="flex shrink-0 items-center gap-1.5 overflow-x-auto rounded-xl border bg-background/55 p-1.5" data-testid="vert-conversion-topology"><Badge variant="secondary" className="shrink-0">{props.routes.length} 组</Badge>{props.routes.map((route) => <div key={route.group.key} className="shrink-0 rounded-md border bg-card px-2 py-1 font-mono text-[11px] font-semibold uppercase">.{route.group.extension} → .{route.config.targetFormat}</div>)}</section>
  return <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto rounded-xl border bg-background/55 p-2" data-testid="vert-conversion-topology"><div className="flex items-center justify-between"><span className="text-xs font-semibold">自动成团与转换组</span><Badge variant="secondary">{props.routes.length}</Badge></div>{props.routes.map((route) => <div key={route.group.key} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-card p-2"><div className="min-w-0"><div className="font-mono text-xs font-semibold uppercase">.{route.group.extension}</div><div className="text-[10px] text-muted-foreground">{route.group.paths.length + route.group.files.length} 个文件</div></div><Route className="size-4 text-primary" /><FormatSelect category={route.config.outputCategory} value={route.config.targetFormat} onChange={(targetFormat) => props.onChange(route.group.key, { ...route.config, targetFormat })} /></div>)}</section>
}

function TopologyEmpty({ compact }: { compact?: boolean }) { return <section className={cn("grid place-items-center rounded-xl border border-dashed bg-background/55 text-center", compact ? "min-h-20 p-3" : "min-h-[330px] p-8")} data-testid="vert-conversion-topology"><div><div className="mx-auto grid size-10 place-items-center rounded-full bg-secondary"><Route /></div><h4 className="mt-2 text-sm font-semibold">拖入文件后自动成团</h4><p className="mt-1 text-xs text-muted-foreground">PNG、JPG、MP4 等输入格式会各自生成一个转换组。</p></div></section> }

function CategorySelect({ group, onChange, value }: { group: VertInputFileGroup; onChange: (value: VertOutputCategory) => void; value: VertOutputCategory }) {
  const allowed = compatibleCategories(group.category)
  return <Select value={value} onValueChange={(next) => onChange(next as VertOutputCategory)}><SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>输出大类</SelectLabel>{allowed.map((category) => <SelectItem key={category} value={category}>{CATEGORY_META[category].label}</SelectItem>)}</SelectGroup></SelectContent></Select>
}

function FormatSelect({ category, onChange, value }: { category: VertOutputCategory; onChange: (value: string) => void; value: string }) {
  const formats = VERT_FORMAT_GROUPS[category]
  const selected = formats.some((format) => format === value) ? value : defaultFormat(category)
  return <Select value={selected} onValueChange={onChange}><SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>{CATEGORY_META[category].label}格式</SelectLabel>{formats.map((format) => <SelectItem key={format} value={format}>.{format}</SelectItem>)}</SelectGroup></SelectContent></Select>
}

export function defaultFormat(category: VertOutputCategory): string { return category === "image" ? "webp" : category === "video" ? "mp4" : category === "audio" ? "mp3" : "docx" }
export function compatibleCategories(category: VertFormatCategory): VertOutputCategory[] { if (category === "audio") return ["audio", "video"]; if (category === "video") return ["video", "audio"]; if (category === "document") return ["document"]; return ["image"] }
function fileName(path: string): string { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
