import { type ReactNode } from "react"
import { BarChart3, FolderOpen } from "lucide-react"
import type { XlchemyData } from "@xiranite/node-xlchemy/core"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { XlchemyEfuAnalysis } from "./types"

type InputEntry = { ext: string; folder: string; size: number }
type Distribution = { key: string; count: number; size: number }

export function DataAnalysis(props: { paths: string[]; fileSizes?: ReadonlyMap<string, number>; efuAnalyses?: XlchemyEfuAnalysis[]; result: XlchemyData | null; activeTab?: "input" | "output"; onTabChange?: (tab: "input" | "output") => void }) {
  const input = buildInputStats(props.paths, props.fileSizes, props.efuAnalyses ?? [], props.result)
  const output = buildOutputStats(props.result)
  return <Tabs defaultValue="input" value={props.activeTab} className="flex min-h-0 flex-col gap-2" data-testid="xlchemy-data-analysis" onValueChange={(tab) => props.onTabChange?.(tab as "input" | "output")}>
    <TabsList className="grid w-full grid-cols-2">
      <TabsTrigger value="input"><FolderOpen data-icon="inline-start" />输入分析</TabsTrigger>
      <TabsTrigger value="output"><BarChart3 data-icon="inline-start" />输出分析</TabsTrigger>
    </TabsList>
    <TabsContent value="input" className="flex flex-col gap-2">
      {input.totalFiles ? <>
        <Summary items={[[formatNumber(input.totalFiles), "文件"], [formatBytes(input.totalSize), "总大小"], [formatBytes(input.avgSize), "平均大小"]]} />
        <Section title="大小范围"><div className="flex justify-between py-0.5 text-[10px] text-muted-foreground"><span>{formatBytes(input.minSize)}</span><span className="font-medium text-foreground">{formatBytes(input.medianSize)}（中位数）</span><span>{formatBytes(input.maxSize)}</span></div></Section>
        <Section title="格式分布"><DistributionBars items={input.formats} /></Section>
        {input.folders.length ? <Section title="目录分布"><DistributionBars accent items={input.folders} /></Section> : null}
      </> : <EmptyAnalysis>添加输入文件后显示数量、大小范围、格式和目录分布。</EmptyAnalysis>}
    </TabsContent>
    <TabsContent value="output" className="flex flex-col gap-2">
      {output.total ? <>
        <Summary highlightFirst items={[[`${output.savedPercent.toFixed(1)}%`, "节省空间"], [formatBytes(output.savedBytes), "节省大小"], [`${output.successCount}/${output.total}`, "成功"]]} />
        {output.speed > 0 ? <Section title="性能"><div className="flex flex-col gap-1">{[["速度", `${output.speed.toFixed(1)} 文件/秒`], ["平均耗时", `${(output.avgTime / 1000).toFixed(1)}s`], ["总耗时", `${(output.elapsed / 1000).toFixed(1)}s`]].map(([label, value]) => <div key={label} className="flex justify-between text-[10px]"><span className="text-muted-foreground">{label}</span><span className="font-semibold tabular-nums">{value}</span></div>)}</div></Section> : null}
        {output.formats.length ? <Section title="格式明细"><RatioBars items={output.formats} /></Section> : null}
        <Section title="大小对比"><SizeComparison before={output.totalSrcSize} after={output.totalDstSize} /></Section>
      </> : <EmptyAnalysis>完成转换后显示节省空间、性能、格式明细与转换前后大小。</EmptyAnalysis>}
    </TabsContent>
  </Tabs>
}

function buildInputStats(paths: string[], fileSizes: ReadonlyMap<string, number> | undefined, efuAnalyses: XlchemyEfuAnalysis[], result: XlchemyData | null) {
  const sizes = new Map([...(fileSizes ?? [])].map(([path, size]) => [normalizePath(path), size] as const))
  for (const file of result?.files ?? []) if (file.sourceBytes !== undefined) sizes.set(normalizePath(file.sourcePath), file.sourceBytes)
  const expectedFiles = paths.length + efuAnalyses.reduce((sum, item) => sum + item.totalFiles, 0)
  const knownDirectFiles = paths.filter((path) => sizes.has(normalizePath(path))).length
  if (result?.inputAnalysis && result.inputAnalysis.totalFiles === expectedFiles && knownDirectFiles < paths.length) return { ...result.inputAnalysis, avgSize: result.inputAnalysis.totalFiles ? Math.round(result.inputAnalysis.totalSize / result.inputAnalysis.totalFiles) : 0 }
  const entries: InputEntry[] = paths.map((path) => {
    const normalized = normalizePath(path), name = normalized.split("/").at(-1) ?? normalized, directory = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "", dot = name.lastIndexOf(".")
    return { ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "unknown", folder: directory.split("/").filter(Boolean).at(-1) ?? "/", size: sizes.get(normalized) ?? 0 }
  })
  const directSize = entries.reduce((sum, entry) => sum + entry.size, 0), sortedSizes = entries.map((entry) => entry.size).sort((a, b) => a - b)
  const totalFiles = entries.length + efuAnalyses.reduce((sum, item) => sum + item.totalFiles, 0)
  const totalSize = directSize + efuAnalyses.reduce((sum, item) => sum + item.totalSize, 0)
  const directFormats = distribute(entries, "ext"), directFolders = distribute(entries, "folder")
  return {
    totalFiles,
    totalSize,
    avgSize: totalFiles ? Math.round(totalSize / totalFiles) : 0,
    minSize: minOrZero([sortedSizes[0], ...efuAnalyses.map((item) => item.minSize)]),
    medianSize: weightedMedianApprox(entries.length ? sortedSizes[Math.floor(sortedSizes.length / 2)] ?? 0 : 0, entries.length, efuAnalyses),
    maxSize: Math.max(sortedSizes.at(-1) ?? 0, ...efuAnalyses.map((item) => item.maxSize)),
    formats: mergeDistributions([directFormats, ...efuAnalyses.map((item) => item.formats)]),
    folders: mergeDistributions([directFolders, ...efuAnalyses.map((item) => item.folders)]).slice(0, 6),
  }
}

function buildOutputStats(result: XlchemyData | null) {
  const files = result?.files.filter((file) => file.status === "converted") ?? [], totalSrcSize = result?.inputBytes ?? files.reduce((sum, file) => sum + (file.sourceBytes ?? 0), 0), totalDstSize = result?.outputBytes ?? files.reduce((sum, file) => sum + (file.outputBytes ?? 0), 0), elapsed = result?.elapsedMs ?? 0
  const formatMap = new Map<string, { count: number; srcSize: number; dstSize: number }>()
  for (const file of result?.outputAnalysis ? [] : files) {
    const name = normalizePath(file.sourcePath).split("/").at(-1) ?? file.sourcePath, dot = name.lastIndexOf("."), ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "unknown", current = formatMap.get(ext) ?? { count: 0, srcSize: 0, dstSize: 0 }
    current.count += 1; current.srcSize += file.sourceBytes ?? 0; current.dstSize += file.outputBytes ?? 0; formatMap.set(ext, current)
  }
  const successCount = result?.convertedCount ?? files.length, failedCount = result?.errorCount ?? 0, total = successCount + failedCount, savedBytes = totalSrcSize - totalDstSize
  const formats = result?.outputAnalysis?.formats.map((item) => ({ key: item.key, count: item.count, srcSize: item.sourceBytes, dstSize: item.outputBytes, ratio: item.sourceBytes > 0 ? item.outputBytes / item.sourceBytes : 0 })) ?? [...formatMap.entries()].map(([key, value]) => ({ key, ...value, ratio: value.srcSize > 0 ? value.dstSize / value.srcSize : 0 })).sort((a, b) => b.count - a.count)
  return { successCount, total, totalSrcSize, totalDstSize, savedBytes, savedPercent: totalSrcSize > 0 ? (1 - totalDstSize / totalSrcSize) * 100 : 0, elapsed, avgTime: successCount ? elapsed / successCount : 0, speed: elapsed > 0 ? successCount / elapsed * 1000 : 0, formats }
}

function distribute(entries: InputEntry[], field: "ext" | "folder"): Distribution[] { const values = new Map<string, { count: number; size: number }>(); for (const entry of entries) { const current = values.get(entry[field]) ?? { count: 0, size: 0 }; current.count += 1; current.size += entry.size; values.set(entry[field], current) } return [...values.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.size - a.size) }
function mergeDistributions(groups: Distribution[][]): Distribution[] { const values = new Map<string, { count: number; size: number }>(); for (const group of groups) for (const item of group) { const current = values.get(item.key) ?? { count: 0, size: 0 }; current.count += item.count; current.size += item.size; values.set(item.key, current) } return [...values.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.size - a.size || b.count - a.count) }
function weightedMedianApprox(directMedian: number, directCount: number, analyses: XlchemyEfuAnalysis[]) { const candidates = [...(directCount ? [{ value: directMedian, count: directCount }] : []), ...analyses.map((item) => ({ value: item.medianSize, count: item.totalFiles }))].sort((a, b) => a.value - b.value), midpoint = candidates.reduce((sum, item) => sum + item.count, 0) / 2; let seen = 0; for (const item of candidates) { seen += item.count; if (seen >= midpoint) return item.value } return 0 }
function minOrZero(values: Array<number | undefined>) { const defined = values.filter((value): value is number => value !== undefined); return defined.length ? Math.min(...defined) : 0 }
function Summary({ highlightFirst, items }: { highlightFirst?: boolean; items: Array<[string, string]> }) { return <div className="grid grid-cols-3 gap-1.5">{items.map(([value, label], index) => <div key={label} className={cn("flex flex-col items-center gap-0.5 rounded-md bg-muted/50 px-1 py-1.5", highlightFirst && index === 0 && "bg-primary/10")}><span className={cn("text-sm font-bold tabular-nums", highlightFirst && index === 0 && "text-primary")}>{value}</span><span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span></div>)}</div> }
function Section({ children, title }: { children: ReactNode; title: string }) { return <section className="flex flex-col gap-1"><h4 className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>{children}</section> }
function DistributionBars({ accent, items }: { accent?: boolean; items: Distribution[] }) { const max = Math.max(...items.map((item) => item.size), 1); return <div className="flex flex-col gap-1">{items.map((item) => <div key={item.key} className="grid h-4 grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-1.5"><span className="truncate text-right text-[10px] font-semibold" title={item.key}>{accent ? item.key : `.${item.key}`}</span><div className="h-2.5 overflow-hidden rounded-sm bg-muted"><div className={cn("h-full min-w-0.5 rounded-sm bg-primary transition-[width]", accent && "bg-chart-2")} style={{ width: `${item.size / max * 100}%` }} /></div><span className="text-[9px] tabular-nums text-muted-foreground">{item.count} · {formatBytes(item.size)}</span></div>)}</div> }
function RatioBars({ items }: { items: Array<{ key: string; count: number; ratio: number }> }) { return <div className="flex flex-col gap-1">{items.map((item) => <div key={item.key} className="grid h-4 grid-cols-[3.5rem_minmax(0,1fr)_4.75rem] items-center gap-1.5"><span className="truncate text-right text-[10px] font-semibold">.{item.key}</span><div className="h-2.5 overflow-hidden rounded-sm bg-muted"><div className="h-full min-w-0.5 rounded-sm bg-chart-3 transition-[width]" style={{ width: `${item.ratio * 100}%` }} /></div><span className="text-[9px] tabular-nums text-muted-foreground">{item.count} · {((1 - item.ratio) * 100).toFixed(0)}% ↓</span></div>)}</div> }
function SizeComparison({ after, before }: { after: number; before: number }) { const ratio = before > 0 ? Math.max(after / before * 100, 2) : 0; return <div className="flex flex-col gap-1"><CompareBar label={`转换前：${formatBytes(before)}`} width={100} /><CompareBar label={`转换后：${formatBytes(after)}`} primary width={ratio} /></div> }
function CompareBar({ label, primary, width }: { label: string; primary?: boolean; width: number }) { return <div className="h-4 overflow-hidden rounded bg-muted"><div className={cn("flex h-full min-w-fit items-center rounded bg-muted-foreground/25 px-1.5 text-[9px] font-medium", primary && "bg-primary/30")} style={{ width: `${width}%` }}><span className="whitespace-nowrap">{label}</span></div></div> }
function EmptyAnalysis({ children }: { children: ReactNode }) { return <div className="px-2 py-5 text-center text-[11px] text-muted-foreground">{children}</div> }
function normalizePath(path: string) { return path.replace(/\\/g, "/") }
function formatNumber(value: number) { return value.toLocaleString() }
function formatBytes(bytes: number) { if (!bytes) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"], index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
