import type { VertFormatCategory } from "@xiranite/node-vert/core"
import { VERT_FORMAT_GROUPS } from "@xiranite/node-vert/core"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { FileAudio, FileImage, FileText, FileVideo, Route, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

interface TopologyProps {
  compact?: boolean
  dense?: boolean
  routes: VertConversionRoute[]
  running: boolean
  onChange: (key: string, config: VertConversionGroupConfig) => void
  onRemoveFile: (file: File) => void
  onRemoveGroup: (group: VertInputFileGroup) => void
  onRemovePath: (path: string) => void
}

export function ConversionTopology(props: TopologyProps) {
  const reduceMotion = useReducedMotion()
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
          const leftPath = `M 275 ${rowY} C 350 ${rowY}, 365 ${categoryY}, 455 ${categoryY}`
          const rightPath = `M 545 ${categoryY} C 635 ${categoryY}, 650 ${rowY}, 725 ${rowY}`
          return <g key={route.group.key} className="text-primary/65"><path d={leftPath} fill="none" opacity=".24" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /><path d={rightPath} fill="none" opacity=".24" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" /><motion.path d={leftPath} animate={reduceMotion ? undefined : { strokeDashoffset: props.running ? [0, -36] : [0, -18] }} fill="none" stroke="currentColor" strokeDasharray="8 10" strokeWidth="3" transition={{ duration: props.running ? 0.8 : 2.4, ease: "linear", repeat: Infinity }} vectorEffect="non-scaling-stroke" /><motion.path d={rightPath} animate={reduceMotion ? undefined : { strokeDashoffset: props.running ? [0, -36] : [0, -18] }} fill="none" stroke="currentColor" strokeDasharray="8 10" strokeWidth="3" transition={{ duration: props.running ? 0.8 : 2.4, ease: "linear", repeat: Infinity }} vectorEffect="non-scaling-stroke" /><circle cx="275" cy={rowY} fill="currentColor" r="5" vectorEffect="non-scaling-stroke" /><circle cx="725" cy={rowY} fill="currentColor" r="5" vectorEffect="non-scaling-stroke" /></g>
        })}
      </svg>
      <div className="relative grid min-h-[330px] grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] gap-x-20">
        <div className="grid gap-2" style={{ gridTemplateRows: `repeat(${routeCount}, minmax(0, 1fr))` }}><AnimatePresence initial={false}>{props.routes.map((route, index) => <SourceGroupCard key={route.group.key} group={route.group} index={index} reduceMotion={reduceMotion} running={props.running} onRemoveFile={props.onRemoveFile} onRemoveGroup={props.onRemoveGroup} onRemovePath={props.onRemovePath} />)}</AnimatePresence></div>
        <div className="grid grid-rows-4 gap-2">{CATEGORY_ORDER.map((category) => <CategoryRouter key={category} category={category} active={props.routes.some((route) => route.group.category === category)} reduceMotion={reduceMotion} />)}</div>
        <div className="grid gap-2" style={{ gridTemplateRows: `repeat(${routeCount}, minmax(0, 1fr))` }}><AnimatePresence initial={false}>{props.routes.map((route, index) => <OutputGroupCard key={route.group.key} index={index} reduceMotion={reduceMotion} route={route} onChange={props.onChange} />)}</AnimatePresence></div>
      </div>
    </div>
  </section>
}

function SourceGroupCard({ group, index, onRemoveFile, onRemoveGroup, onRemovePath, reduceMotion, running }: { group: VertInputFileGroup; index: number; onRemoveFile: (file: File) => void; onRemoveGroup: (group: VertInputFileGroup) => void; onRemovePath: (path: string) => void; reduceMotion: boolean | null; running: boolean }) {
  const category = group.category === "unknown" ? "document" : group.category
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  const total = group.paths.length + group.files.length
  return <motion.article layout initial={reduceMotion ? false : { opacity: 0, x: -24, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, x: -18, scale: 0.96 }} transition={{ delay: reduceMotion ? 0 : index * 0.05, duration: 0.24 }} className="flex min-h-0 flex-col rounded-xl border bg-card/90 px-3 py-2 shadow-sm"><div className="flex items-center gap-2"><div className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", meta.className)}><Icon className="size-4" /></div><span className="font-mono text-sm font-semibold uppercase">.{group.extension}</span><Badge variant="outline">{total} 个</Badge><span className="ml-auto text-[10px] text-muted-foreground">文件团</span><Button aria-label={`清空 .${group.extension} 文件团`} disabled={running} size="icon-xs" variant="ghost" onClick={() => onRemoveGroup(group)}><Trash2 /></Button></div><ul className="mt-1 min-h-0 space-y-0.5 overflow-y-auto"><AnimatePresence initial={false}>{group.paths.map((path) => <FileRow key={`path:${path}`} engine="CLI" label={fileName(path)} title={path} disabled={running} onRemove={() => onRemovePath(path)} />)}{group.files.map((file) => <FileRow key={`file:${browserFileKey(file)}`} engine="Wasm" label={file.name} title={file.name} disabled={running} onRemove={() => onRemoveFile(file)} />)}</AnimatePresence></ul></motion.article>
}

function CategoryRouter({ active, category, reduceMotion }: { active: boolean; category: VertOutputCategory; reduceMotion: boolean | null }) {
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  return <motion.div layout animate={reduceMotion ? undefined : { opacity: active ? 1 : 0.34, scale: active ? 1 : 0.96 }} transition={{ duration: 0.24 }} className={cn("relative flex flex-col items-center justify-center rounded-xl border px-2 text-center", meta.className)}><Icon className="mb-1 size-5" /><span className="text-xs font-semibold">{meta.label}</span><span className="text-[10px] opacity-70">自动路由</span><AnimatePresence>{active ? <motion.span initial={reduceMotion ? false : { scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute -right-1 -top-1 size-2.5 rounded-full bg-primary ring-2 ring-background" /> : null}</AnimatePresence></motion.div>
}

function OutputGroupCard({ index, onChange, reduceMotion, route }: { index: number; onChange: (key: string, config: VertConversionGroupConfig) => void; reduceMotion: boolean | null; route: VertConversionRoute }) {
  return <motion.article layout initial={reduceMotion ? false : { opacity: 0, x: 24, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, x: 18, scale: 0.96 }} transition={{ delay: reduceMotion ? 0 : index * 0.05, duration: 0.24 }} className="flex min-h-0 flex-col justify-center gap-2 rounded-xl border bg-card/90 px-3 py-2 shadow-sm"><div className="flex items-center gap-2"><Route className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold uppercase">.{route.group.extension} → .{route.config.targetFormat}</span><Badge variant="outline">转换组</Badge></div><div className="grid grid-cols-2 gap-2"><CategorySelect group={route.group} value={route.config.outputCategory} onChange={(outputCategory) => onChange(route.group.key, { outputCategory, targetFormat: defaultFormat(outputCategory) })} /><FormatSelect category={route.config.outputCategory} value={route.config.targetFormat} onChange={(targetFormat) => onChange(route.group.key, { ...route.config, targetFormat })} /></div></motion.article>
}

function CompactTopology(props: TopologyProps) {
  const reduceMotion = useReducedMotion()
  if (props.dense) return <section className="flex shrink-0 items-center gap-1.5 overflow-x-auto rounded-xl border bg-background/55 p-1.5" data-testid="vert-conversion-topology"><Badge variant="secondary" className="shrink-0">{props.routes.length} 组</Badge><AnimatePresence initial={false}>{props.routes.map((route) => <motion.div layout key={route.group.key} initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex shrink-0 items-center rounded-md border bg-card pl-2 font-mono text-[11px] font-semibold uppercase"><span>.{route.group.extension} → .{route.config.targetFormat}</span><Button aria-label={`清空 .${route.group.extension} 文件团`} disabled={props.running} size="icon-xs" variant="ghost" onClick={() => props.onRemoveGroup(route.group)}><X /></Button></motion.div>)}</AnimatePresence></section>
  return <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto rounded-xl border bg-background/55 p-2" data-testid="vert-conversion-topology"><div className="flex items-center justify-between"><span className="text-xs font-semibold">自动成团与转换组</span><Badge variant="secondary">{props.routes.length}</Badge></div><AnimatePresence initial={false}>{props.routes.map((route) => <motion.div layout key={route.group.key} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-lg border bg-card p-2"><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2"><div className="min-w-0"><div className="font-mono text-xs font-semibold uppercase">.{route.group.extension}</div><div className="text-[10px] text-muted-foreground">{route.group.paths.length + route.group.files.length} 个文件</div></div><Route className="size-4 text-primary" /><FormatSelect category={route.config.outputCategory} value={route.config.targetFormat} onChange={(targetFormat) => props.onChange(route.group.key, { ...route.config, targetFormat })} /><Button aria-label={`清空 .${route.group.extension} 文件团`} disabled={props.running} size="icon-xs" variant="ghost" onClick={() => props.onRemoveGroup(route.group)}><Trash2 /></Button></div><div className="mt-1 flex gap-1 overflow-x-auto">{route.group.paths.map((path) => <CompactFileChip key={`path:${path}`} label={fileName(path)} disabled={props.running} onRemove={() => props.onRemovePath(path)} />)}{route.group.files.map((file) => <CompactFileChip key={`file:${browserFileKey(file)}`} label={file.name} disabled={props.running} onRemove={() => props.onRemoveFile(file)} />)}</div></motion.div>)}</AnimatePresence></section>
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

function FileRow({ disabled, engine, label, onRemove, title }: { disabled: boolean; engine: "CLI" | "Wasm"; label: string; onRemove: () => void; title: string }) { return <motion.li layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] hover:bg-muted/60"><span className="min-w-0 flex-1 truncate text-muted-foreground" title={title}>{label}</span><span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">{engine}</span><Button aria-label={`移除 ${label}`} className="opacity-45 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" disabled={disabled} size="icon-xs" variant="ghost" onClick={onRemove}><X /></Button></motion.li> }
function CompactFileChip({ disabled, label, onRemove }: { disabled: boolean; label: string; onRemove: () => void }) { return <span className="flex shrink-0 items-center rounded-md bg-muted/70 pl-1.5 text-[10px]"><span className="max-w-28 truncate">{label}</span><Button aria-label={`移除 ${label}`} disabled={disabled} size="icon-xs" variant="ghost" onClick={onRemove}><X /></Button></span> }

export function defaultFormat(category: VertOutputCategory): string { return category === "image" ? "webp" : category === "video" ? "mp4" : category === "audio" ? "mp3" : "docx" }
export function compatibleCategories(category: VertFormatCategory): VertOutputCategory[] { if (category === "audio") return ["audio", "video"]; if (category === "video") return ["video", "audio"]; if (category === "document") return ["document"]; return ["image"] }
function fileName(path: string): string { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
function browserFileKey(file: File): string { return `${file.name}:${file.size}:${file.lastModified}` }
