import { useState } from "react"
import type { NodeComponentProps, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { smartSelect, type CzkawkaAction, type CzkawkaData, type CzkawkaEntry, type CzkawkaInput, type CzkawkaSelectionStrategy, type CzkawkaSort, type CzkawkaTool } from "@xiranite/node-czkawka/core"
import { AlertTriangle, ArchiveX, AudioLines, Copy, FileQuestion, FileX2, FolderSearch2, FolderX, HardDrive, Image, Link2Off, ListFilter, MoveRight, Play, Save, Search, Trash2, Video, X } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PathTextarea } from "@/components/ui/path-input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { LocalImagePreview } from "@/nodes/shared/LocalImagePreview"
import { createCzkawkaScanInput, getCzkawkaToolOptions, type CzkawkaOptionDefinition } from "@xiranite/node-czkawka/tool-options"
import type { CzkawkaCardState, CzkawkaPanel } from "./types"

const TOOLS: Array<{ id: CzkawkaTool; label: string; short: string; icon: typeof Copy }> = [
  { id: "duplicate-files", label: "重复文件", short: "重复", icon: Copy },
  { id: "empty-folders", label: "空文件夹", short: "空夹", icon: FolderX },
  { id: "big-files", label: "大文件", short: "大文件", icon: HardDrive },
  { id: "empty-files", label: "空文件", short: "空文件", icon: FileX2 },
  { id: "temporary-files", label: "临时文件", short: "临时", icon: Trash2 },
  { id: "similar-images", label: "相似图片", short: "图片", icon: Image },
  { id: "similar-videos", label: "相似视频", short: "视频", icon: Video },
  { id: "duplicate-music", label: "重复音频", short: "音频", icon: AudioLines },
  { id: "invalid-symlinks", label: "无效符号链接", short: "链接", icon: Link2Off },
  { id: "broken-files", label: "损坏文件", short: "损坏", icon: FileQuestion },
  { id: "bad-extensions", label: "不正确扩展名", short: "扩展名", icon: ArchiveX },
]

const GROUP_TRACKS = ["border-l-chart-1", "border-l-chart-2", "border-l-chart-3", "border-l-chart-4", "border-l-chart-5"]
const GROUP_DOTS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]

export function Component({ compId, host }: NodeComponentProps<CzkawkaCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t } = useNodeI18n("czkawka")
  const data = getData(host, compId)
  const [running, setRunning] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [panel, setPanel] = useState<CzkawkaPanel>("source")
  const tool = data.tool ?? "duplicate-files"
  const result = data.result ?? null
  const visibleGroups = filterGroups(result, data.filterText ?? "", data.sortBy ?? "path", data.descending ?? false)
  const compact = surface.mode === "compact" || surface.mode === "portrait"

  function patch(next: Partial<CzkawkaCardState>) {
    if (host.state?.patchData) host.state.patchData(next)
    else host.patchData(compId, next)
  }

  async function executeScan() {
    if (running) return
    const includedDirectories = lines(data.includedDirectoriesText)
    if (!includedDirectories.length) { patch({ phase: "error", progressText: t("errors.noRoots", "请至少添加一个包含目录。") }); return }
    const run = host.runner?.run ?? host.actions?.run
    if (!run) { patch({ phase: "error", progressText: t("errors.noRuntime", "当前环境没有本地运行能力。") }); return }
    setRunning(true)
    setSelectedPaths([])
    patch({ phase: "running", progress: 0, progressText: t("progress.starting", "正在启动 Czkawka 扫描。"), result: null })
    try {
      const response = await run<CzkawkaInput, CzkawkaData>("czkawka", scanInput(tool, data), (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ progress: event.progress ?? 0, progressText: event.message })
      }) as NodeRunResult<CzkawkaData>
      patch({ phase: response.success ? "completed" : "error", progress: response.success ? 100 : 0, progressText: response.message, result: response.data ?? null })
      setPanel("results")
    } catch (error) { patch({ phase: "error", progressText: message(error) }) }
    finally { setRunning(false) }
  }

  async function executeOperation(action: CzkawkaAction) {
    const run = host.runner?.run ?? host.actions?.run
    if (!run || !selectedPaths.length || running) return
    setRunning(true)
    patch({ progressText: `${action} ${selectedPaths.length} item(s)…` })
    try {
      const response = await run<CzkawkaInput, CzkawkaData>("czkawka", { action, selectedPaths, dryRun: data.dryRun ?? true, destinationDirectory: data.destinationDirectory, outputPath: data.outputPath, outputFormat: data.outputPath?.toLowerCase().endsWith(".csv") ? "csv" : "json" }) as NodeRunResult<CzkawkaData>
      patch({ progressText: response.message, operation: response.data ?? null, phase: response.success ? "completed" : "error" })
      if (response.success && data.dryRun === false && action !== "save") setSelectedPaths([])
    } catch (error) { patch({ phase: "error", progressText: message(error) }) }
    finally { setRunning(false) }
  }

  function togglePath(path: string, checked: boolean) { setSelectedPaths((current) => checked ? [...new Set([...current, path])] : current.filter((item) => item !== path)) }
  function selectGroup(entries: CzkawkaEntry[], checked: boolean) { const paths = entries.map((entry) => entry.path); setSelectedPaths((current) => checked ? [...new Set([...current, ...paths])] : current.filter((path) => !paths.includes(path))) }
  function applySmartSelection(strategy: CzkawkaSelectionStrategy) { if (result) setSelectedPaths(smartSelect(result.groups, strategy)) }

  const view = { data, tool, result, visibleGroups, running, selectedPaths, panel, getFileUrl: host.localFiles?.getUrl, patch, setPanel, executeScan, executeOperation, togglePath, selectGroup, applySmartSelection }
  return <TooltipProvider><div ref={surface.ref} data-testid="czkawka-surface" className="@container/czkawka flex h-full min-h-0 w-full overflow-hidden bg-background">
    {surface.mode === "collapsed" ? <Collapsed {...view} /> : compact ? <Compact {...view} /> : <Full {...view} />}
  </div></TooltipProvider>
}

type View = {
  data: CzkawkaCardState; tool: CzkawkaTool; result: CzkawkaData | null; visibleGroups: CzkawkaData["groups"]; running: boolean; selectedPaths: string[]; panel: CzkawkaPanel
  getFileUrl?: (path: string) => string
  patch: (next: Partial<CzkawkaCardState>) => void; setPanel: (panel: CzkawkaPanel) => void; executeScan: () => Promise<void>; executeOperation: (action: CzkawkaAction) => Promise<void>; togglePath: (path: string, checked: boolean) => void; selectGroup: (entries: CzkawkaEntry[], checked: boolean) => void
  applySmartSelection: (strategy: CzkawkaSelectionStrategy) => void
}

function Full(props: View) {
  return <div data-testid="czkawka-full-view" className="flex min-h-0 flex-1 flex-col gap-2 p-2"><Header {...props} /><div className="grid min-h-0 flex-1 grid-cols-[176px_minmax(230px,0.8fr)_minmax(440px,1.8fr)_minmax(210px,0.75fr)] gap-2"><ToolRail {...props} /><SourcePanel {...props} /><ResultTable {...props} /><AnalysisPanel {...props} /></div><StatusBar {...props} /></div>
}

function Compact(props: View) {
  return <div data-testid="czkawka-compact-view" className="flex min-h-0 flex-1 flex-col gap-2 p-2"><Header {...props} /><Tabs value={props.panel} onValueChange={(value) => props.setPanel(value as CzkawkaPanel)}><TabsList className="grid w-full grid-cols-3"><TabsTrigger value="source">条件</TabsTrigger><TabsTrigger value="results">结果 <Badge variant="outline">{props.result?.fileCount ?? 0}</Badge></TabsTrigger><TabsTrigger value="analysis">统计</TabsTrigger></TabsList></Tabs><div className="min-h-0 flex-1 overflow-hidden">{props.panel === "source" ? <div className="grid h-full min-h-0 grid-cols-[132px_minmax(0,1fr)] gap-2"><ToolRail {...props} /><SourcePanel {...props} /></div> : props.panel === "results" ? <ResultTable {...props} /> : <AnalysisPanel {...props} />}</div><StatusBar {...props} /></div>
}

function Collapsed(props: View) {
  const meta = toolMeta(props.tool)
  return <div data-testid="czkawka-collapsed-view" className="flex h-full w-full items-center gap-2 rounded-lg border bg-card px-3"><meta.icon className="size-5 text-primary" /><div className="min-w-0 flex-1"><div className="text-sm font-semibold">Czkawka · {meta.label}</div><div className="truncate text-xs text-muted-foreground">{props.data.progressText || `${props.result?.fileCount ?? 0} 个结果`}</div></div><Badge variant={props.data.phase === "error" ? "destructive" : "outline"}>{props.data.phase ?? "idle"}</Badge><Button disabled={props.running} size="icon-sm" onClick={props.executeScan}><Play /></Button></div>
}

function Header(props: View) {
  const meta = toolMeta(props.tool)
  return <header className="flex shrink-0 items-center justify-between gap-3 border-b pb-2"><div className="flex min-w-0 items-center gap-2"><div className="grid size-9 place-items-center rounded-md border bg-muted/40"><meta.icon className="size-5 text-primary" /></div><div className="min-w-0"><h3 className="truncate text-base font-semibold tracking-tight">Czkawka · {meta.label}</h3><p className="truncate font-mono text-[11px] text-muted-foreground">FILE FORENSICS / 11 SCANNERS / TS CONTROL PLANE</p></div></div><div className="flex items-center gap-2"><Badge variant="outline">{props.selectedPaths.length} 已选</Badge><Button disabled={props.running} size="sm" onClick={props.executeScan}>{props.running ? <Search className="animate-pulse" /> : <Play />}{props.running ? "扫描中" : "开始扫描"}</Button></div></header>
}

function ToolRail(props: View) {
  return <aside className="flex min-h-0 flex-col rounded-md border bg-card"><div className="border-b px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">扫描工具</div><ScrollArea className="min-h-0 flex-1"><div className="grid gap-0.5 p-1">{TOOLS.map((tool) => <Tooltip key={tool.id}><TooltipTrigger asChild><button type="button" aria-label={tool.label} data-active={props.tool === tool.id} className="flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-primary data-[active=true]:text-primary-foreground" onClick={() => props.patch({ tool: tool.id })}><tool.icon className="size-3.5 shrink-0" /><span className="truncate">{tool.short}</span></button></TooltipTrigger><TooltipContent side="right">{tool.label}</TooltipContent></Tooltip>)}</div></ScrollArea></aside>
}

function SourcePanel(props: View) {
  return <section className="flex min-h-0 flex-col rounded-md border bg-card"><SectionHeader icon={FolderSearch2} title="扫描条件" /><ScrollArea className="min-h-0 flex-1"><div className="grid gap-3 p-3"><Field label="包含目录"><PathTextarea aria-label="czkawka included directories" className="min-h-28 resize-none font-mono text-xs" placeholder="D:/Media\nE:/Archive" value={props.data.includedDirectoriesText ?? ""} onValueChange={(includedDirectoriesText) => props.patch({ includedDirectoriesText })} /></Field><Field label="参考目录"><PathTextarea aria-label="czkawka reference directories" className="min-h-16 resize-none font-mono text-xs" placeholder="只保留这些目录中的文件" value={props.data.includedDirectoriesReferencedText ?? ""} onValueChange={(includedDirectoriesReferencedText) => props.patch({ includedDirectoriesReferencedText })} /></Field><Field label="排除目录"><PathTextarea aria-label="czkawka excluded directories" className="min-h-20 resize-none font-mono text-xs" value={props.data.excludedDirectoriesText ?? ""} onValueChange={(excludedDirectoriesText) => props.patch({ excludedDirectoriesText })} /></Field><Field label="排除项目"><Input value={props.data.excludedItemsText ?? ""} placeholder="*/cache/*; *.part" onChange={(event) => props.patch({ excludedItemsText: event.currentTarget.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="允许扩展名"><Input value={props.data.allowedExtensions ?? ""} placeholder="jpg,png" onChange={(event) => props.patch({ allowedExtensions: event.currentTarget.value })} /></Field><Field label="排除扩展名"><Input value={props.data.excludedExtensions ?? ""} placeholder="tmp,bak" onChange={(event) => props.patch({ excludedExtensions: event.currentTarget.value })} /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="最小文件大小（B）"><Input type="number" min={0} value={props.data.minimumFileSize ?? "1"} onChange={(event) => props.patch({ minimumFileSize: event.currentTarget.value })} /></Field><Field label="最大文件大小（B）"><Input type="number" min={1} value={props.data.maximumFileSize ?? ""} placeholder="不限" onChange={(event) => props.patch({ maximumFileSize: event.currentTarget.value })} /></Field></div><SwitchLine label="递归扫描" checked={props.data.recursive ?? true} onChange={(recursive) => props.patch({ recursive })} /><SwitchLine label="使用缓存" checked={props.data.useCache ?? true} onChange={(useCache) => props.patch({ useCache })} /><AlgorithmFields {...props} /></div></ScrollArea></section>
}

function AlgorithmFields(props: View) {
  return <div className="grid gap-2">{getCzkawkaToolOptions(props.tool).map((definition) => <SchemaOptionField key={definition.id} definition={definition} {...props} />)}</div>
}

function SchemaOptionField({ data, definition, patch }: View & { definition: CzkawkaOptionDefinition }) {
  const value = data[definition.id as keyof CzkawkaCardState] ?? definition.defaultValue
  if (definition.kind === "boolean") return <SwitchLine label={definition.label.zh} checked={Boolean(value)} onChange={(checked) => patch({ [definition.id]: checked } as Partial<CzkawkaCardState>)} />
  if (definition.kind === "number") return <Field label={definition.label.zh}><Input type="number" min={definition.min} max={definition.max} value={String(value)} onChange={(event) => patch({ [definition.id]: event.currentTarget.value } as Partial<CzkawkaCardState>)} /></Field>
  return <Field label={definition.label.zh}><Select value={String(value)} onValueChange={(next) => patch({ [definition.id]: next } as Partial<CzkawkaCardState>)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{definition.choices?.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label ?? choice.value}</SelectItem>)}</SelectContent></Select></Field>
}

/* Legacy fork-specific layout retained temporarily while M1 switches to schema rendering.
  if (props.tool === "duplicate-files") return <div className="grid gap-2"><div className="grid grid-cols-2 gap-2"><Field label="判断方式"><Select value={props.data.checkMethod ?? "hash"} onValueChange={(checkMethod) => props.patch({ checkMethod: checkMethod as CzkawkaCardState["checkMethod"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hash">Hash</SelectItem><SelectItem value="name">名称</SelectItem><SelectItem value="size">大小</SelectItem><SelectItem value="size-and-name">大小与名称</SelectItem></SelectContent></Select></Field><Field label="哈希"><Select value={props.data.hashType ?? "blake3"} onValueChange={(hashType) => props.patch({ hashType: hashType as CzkawkaCardState["hashType"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="blake3">BLAKE3</SelectItem><SelectItem value="xxh3">XXH3</SelectItem><SelectItem value="crc32">CRC32</SelectItem></SelectContent></Select></Field></div><Field label="最小组大小"><Input type="number" min={1} max={10000} value={props.data.duplicateMinimumGroupSize ?? "1"} onChange={(event) => props.patch({ duplicateMinimumGroupSize: event.currentTarget.value })} /></Field><SwitchLine label="名称区分大小写" checked={props.data.caseSensitiveNames ?? false} onChange={(caseSensitiveNames) => props.patch({ caseSensitiveNames })} /><SwitchLine label="忽略硬链接" checked={props.data.ignoreHardLinks ?? true} onChange={(ignoreHardLinks) => props.patch({ ignoreHardLinks })} /><SwitchLine label="使用预哈希" checked={props.data.usePrehash ?? true} onChange={(usePrehash) => props.patch({ usePrehash })} /></div>
  if (props.tool === "big-files") return <div className="grid gap-2"><Field label="结果数量"><Input type="number" value={props.data.numberOfFiles ?? "50"} onChange={(event) => props.patch({ numberOfFiles: event.currentTarget.value })} /></Field><SwitchLine label="优先最大文件" checked={props.data.biggestFirst ?? true} onChange={(biggestFirst) => props.patch({ biggestFirst })} /></div>
  if (props.tool === "similar-images") return <div className="grid gap-2"><Field label="最大差异"><Input type="number" min={0} max={40} value={props.data.similarity ?? "10"} onChange={(event) => props.patch({ similarity: event.currentTarget.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Hash 尺寸"><Select value={props.data.similarImagesHashSize ?? "16"} onValueChange={(similarImagesHashSize) => props.patch({ similarImagesHashSize })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["8", "16", "32", "64"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field><Field label="Hash 算法"><Select value={props.data.similarImagesHashAlgorithm ?? "mean"} onValueChange={(similarImagesHashAlgorithm) => props.patch({ similarImagesHashAlgorithm: similarImagesHashAlgorithm as CzkawkaCardState["similarImagesHashAlgorithm"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mean">Mean</SelectItem><SelectItem value="gradient">Gradient</SelectItem><SelectItem value="blockhash">BlockHash</SelectItem><SelectItem value="vert-gradient">VertGradient</SelectItem><SelectItem value="double-gradient">DoubleGradient</SelectItem><SelectItem value="median">Median</SelectItem></SelectContent></Select></Field></div><Field label="缩放算法"><Select value={props.data.similarImagesResizeAlgorithm ?? "lanczos3"} onValueChange={(similarImagesResizeAlgorithm) => props.patch({ similarImagesResizeAlgorithm: similarImagesResizeAlgorithm as CzkawkaCardState["similarImagesResizeAlgorithm"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lanczos3">Lanczos3</SelectItem><SelectItem value="gaussian">Gaussian</SelectItem><SelectItem value="catmull-rom">CatmullRom</SelectItem><SelectItem value="triangle">Triangle</SelectItem><SelectItem value="nearest">Nearest</SelectItem></SelectContent></Select></Field><Field label="文件夹阈值"><Input type="number" min={1} value={props.data.similarImagesFolderThreshold ?? "2"} onChange={(event) => props.patch({ similarImagesFolderThreshold: event.currentTarget.value })} /></Field><SwitchLine label="忽略相同尺寸" checked={props.data.similarImagesIgnoreSameSize ?? false} onChange={(similarImagesIgnoreSameSize) => props.patch({ similarImagesIgnoreSameSize })} /></div>
  if (props.tool === "similar-videos") return <div className="grid gap-2"><Field label="最大差异"><Input type="number" min={0} max={20} value={props.data.similarity ?? "10"} onChange={(event) => props.patch({ similarity: event.currentTarget.value })} /></Field><SwitchLine label="忽略相同尺寸" checked={props.data.similarVideosIgnoreSameSize ?? false} onChange={(similarVideosIgnoreSameSize) => props.patch({ similarVideosIgnoreSameSize })} /><div className="grid grid-cols-2 gap-2"><Field label="跳过开头（秒）"><Input type="number" min={0} value={props.data.similarVideosSkipForward ?? "15"} onChange={(event) => props.patch({ similarVideosSkipForward: event.currentTarget.value })} /></Field><Field label="Hash 时长（秒）"><Input type="number" min={2} value={props.data.similarVideosHashDuration ?? "10"} onChange={(event) => props.patch({ similarVideosHashDuration: event.currentTarget.value })} /></Field></div><Field label="裁剪检测"><Select value={props.data.similarVideosCropDetect ?? "letterbox"} onValueChange={(similarVideosCropDetect) => props.patch({ similarVideosCropDetect: similarVideosCropDetect as CzkawkaCardState["similarVideosCropDetect"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="letterbox">Letterbox</SelectItem><SelectItem value="motion">Motion</SelectItem><SelectItem value="none">None</SelectItem></SelectContent></Select></Field></div>
  if (props.tool === "duplicate-music") return <MusicFields {...props} />
  if (props.tool === "broken-files") return <div className="grid gap-2"><SwitchLine label="音频" checked={props.data.brokenAudio ?? true} onChange={(brokenAudio) => props.patch({ brokenAudio })} /><SwitchLine label="PDF" checked={props.data.brokenPdf ?? true} onChange={(brokenPdf) => props.patch({ brokenPdf })} /><SwitchLine label="压缩包" checked={props.data.brokenArchive ?? true} onChange={(brokenArchive) => props.patch({ brokenArchive })} /><SwitchLine label="图片" checked={props.data.brokenImage ?? true} onChange={(brokenImage) => props.patch({ brokenImage })} /></div>
  return null
}

function MusicFields(props: View) {
  const fingerprint = (props.data.musicCheckType ?? "tags") === "fingerprint"
  return <div className="grid gap-2"><Field label="音频判断方式"><Select value={props.data.musicCheckType ?? "tags"} onValueChange={(musicCheckType) => props.patch({ musicCheckType: musicCheckType as CzkawkaCardState["musicCheckType"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tags">标签</SelectItem><SelectItem value="fingerprint">音频指纹</SelectItem></SelectContent></Select></Field>{fingerprint ? <><Field label="最大差异"><Input type="number" min={0} max={10} value={props.data.musicMaximumDifference ?? "10"} onChange={(event) => props.patch({ musicMaximumDifference: event.currentTarget.value })} /></Field><Field label="最小片段时长"><Input type="number" min={0} value={props.data.musicMinimumFragmentDuration ?? "15"} onChange={(event) => props.patch({ musicMinimumFragmentDuration: event.currentTarget.value })} /></Field><SwitchLine label="仅比较相似标题" checked={props.data.musicCompareFingerprintsOnlyWithSimilarTitles ?? true} onChange={(musicCompareFingerprintsOnlyWithSimilarTitles) => props.patch({ musicCompareFingerprintsOnlyWithSimilarTitles })} /></> : <><SwitchLine label="近似标签比较" checked={props.data.musicApproximateComparison ?? true} onChange={(musicApproximateComparison) => props.patch({ musicApproximateComparison })} /><div className="grid grid-cols-2 gap-1"><SwitchLine label="标题" checked={props.data.musicCompareTitle ?? true} onChange={(musicCompareTitle) => props.patch({ musicCompareTitle })} /><SwitchLine label="艺术家" checked={props.data.musicCompareArtist ?? true} onChange={(musicCompareArtist) => props.patch({ musicCompareArtist })} /><SwitchLine label="比特率" checked={props.data.musicCompareBitrate ?? false} onChange={(musicCompareBitrate) => props.patch({ musicCompareBitrate })} /><SwitchLine label="流派" checked={props.data.musicCompareGenre ?? false} onChange={(musicCompareGenre) => props.patch({ musicCompareGenre })} /><SwitchLine label="年份" checked={props.data.musicCompareYear ?? false} onChange={(musicCompareYear) => props.patch({ musicCompareYear })} /><SwitchLine label="时长" checked={props.data.musicCompareLength ?? false} onChange={(musicCompareLength) => props.patch({ musicCompareLength })} /></div></>}</div>
}
*/

function ResultTable(props: View) {
  return <section className="flex min-h-0 flex-col rounded-md border bg-card"><div className="flex items-center justify-between gap-2 border-b px-2 py-1.5"><SectionTitle icon={ListFilter} title="结果组" /><div className="flex items-center gap-1"><Input aria-label="filter results" className="h-7 w-40 text-xs" placeholder="过滤路径或详情" value={props.data.filterText ?? ""} onChange={(event) => props.patch({ filterText: event.currentTarget.value })} /><Select value={props.data.sortBy ?? "path"} onValueChange={(sortBy) => props.patch({ sortBy: sortBy as CzkawkaSort })}><SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="path">路径</SelectItem><SelectItem value="size">大小</SelectItem><SelectItem value="modified">修改时间</SelectItem></SelectContent></Select><Button aria-label="toggle sort direction" size="icon-xs" variant="ghost" onClick={() => props.patch({ descending: !(props.data.descending ?? false) })}>{props.data.descending ? "↓" : "↑"}</Button></div></div><ScrollArea className="min-h-0 flex-1"><Table className="text-xs"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-10" /><TableHead className="w-12" /><TableHead className="w-16">组</TableHead><TableHead>文件</TableHead><TableHead className="w-24 text-right">大小</TableHead><TableHead className="w-36">详情</TableHead></TableRow></TableHeader><TableBody>{props.visibleGroups.length ? props.visibleGroups.flatMap((group) => group.entries.map((entry, index) => <ResultRow key={entry.id} entry={entry} group={group} index={index} selected={props.selectedPaths.includes(entry.path)} allSelected={group.entries.filter((item) => !item.isReference).every((item) => props.selectedPaths.includes(item.path))} getFileUrl={props.getFileUrl} onToggle={props.togglePath} onToggleGroup={props.selectGroup} />)) : <TableRow><TableCell colSpan={6} className="h-56 text-center text-muted-foreground">{props.running ? "正在分析文件…" : "添加目录并开始扫描。结果会按关系分组显示。"}</TableCell></TableRow>}</TableBody></Table></ScrollArea></section>
}

function ResultRow({ entry, group, index, selected, allSelected, getFileUrl, onToggle, onToggleGroup }: { entry: CzkawkaEntry; group: CzkawkaData["groups"][number]; index: number; selected: boolean; allSelected: boolean; getFileUrl?: (path: string) => string; onToggle: (path: string, checked: boolean) => void; onToggleGroup: (entries: CzkawkaEntry[], checked: boolean) => void }) {
  const track = GROUP_TRACKS[group.id % GROUP_TRACKS.length]!, dot = GROUP_DOTS[group.id % GROUP_DOTS.length]!
  return <TableRow data-state={selected ? "selected" : undefined} className={cn("border-l-4", track)}><TableCell><Checkbox aria-label={`选择 ${entry.name}`} disabled={entry.isReference} checked={selected} onCheckedChange={(checked) => onToggle(entry.path, checked === true)} /></TableCell><TableCell><ImagePreview path={entry.path} getFileUrl={getFileUrl} /></TableCell><TableCell><button className="flex items-center gap-1 font-mono" onClick={() => onToggleGroup(group.entries.filter((item) => !item.isReference), !allSelected)}><span className={cn("size-2 rounded-full", dot)} />{String(group.id + 1).padStart(2, "0")}{index === 0 && group.entries.length > 1 ? <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px]">{group.entries.length}</Badge> : null}</button></TableCell><TableCell><div className="flex max-w-[34rem] items-center gap-1 truncate font-mono" title={entry.path}>{entry.isReference ? <Badge variant="secondary" className="h-4 px-1 text-[9px]">参考</Badge> : null}<span className="truncate">{entry.path}</span></div>{entry.secondaryPath ? <div className="max-w-[34rem] truncate text-[10px] text-muted-foreground">→ {entry.secondaryPath}</div> : null}</TableCell><TableCell className="text-right font-mono">{formatBytes(entry.size)}</TableCell><TableCell className="max-w-36 truncate text-muted-foreground">{entry.detail || entry.properExtension || entry.similarity || [entry.artist, entry.title].filter(Boolean).join(" · ") || "—"}</TableCell></TableRow>
}

function ImagePreview({ path, getFileUrl }: { path: string; getFileUrl?: (path: string) => string }) { return <LocalImagePreview path={path} getFileUrl={getFileUrl} className="size-9" /> }

function AnalysisPanel(props: View) {
  const stats = props.result
  return <section className="flex min-h-0 flex-col rounded-md border bg-card"><SectionHeader icon={Search} title="分析与操作" /><div className="grid grid-cols-2 gap-px border-b bg-border"><Metric label="文件" value={String(stats?.fileCount ?? 0)} /><Metric label="分组" value={String(stats?.groupCount ?? 0)} /><Metric label="总大小" value={formatBytes(stats?.totalBytes ?? 0)} /><Metric label="可回收" value={formatBytes(stats?.reclaimableBytes ?? 0)} accent /></div><ScrollArea className="min-h-0 flex-1"><div className="grid gap-3 p-3"><div className="text-xs text-muted-foreground">已选择 <strong className="text-foreground">{props.selectedPaths.length}</strong> 个路径。删除和移动默认只生成计划。</div><Field label="智能选择"><div className="grid grid-cols-2 gap-1"><Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-first")}>每组除首个</Button><Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-newest")}>保留最新</Button><Button size="xs" variant="outline" onClick={() => props.applySmartSelection("all-except-biggest")}>保留最大</Button><Button size="xs" variant="ghost" onClick={() => props.patch({ operation: null })}><X />清除操作</Button></div></Field><SwitchLine label="仅预演操作" checked={props.data.dryRun ?? true} onChange={(dryRun) => props.patch({ dryRun })} /><Separator /><Field label="移动到"><div className="flex gap-1"><Input value={props.data.destinationDirectory ?? ""} placeholder="D:/Review" onChange={(event) => props.patch({ destinationDirectory: event.currentTarget.value })} /><Button aria-label="move selected" disabled={!props.selectedPaths.length || props.running} size="icon-sm" variant="outline" onClick={() => void props.executeOperation("move")}><MoveRight /></Button></div></Field><Field label="导出结果"><div className="flex gap-1"><Input value={props.data.outputPath ?? ""} placeholder="D:/result.json" onChange={(event) => props.patch({ outputPath: event.currentTarget.value })} /><Button aria-label="save selected" disabled={!props.selectedPaths.length || !props.data.outputPath || props.running} size="icon-sm" variant="outline" onClick={() => void props.executeOperation("save")}><Save /></Button></div></Field><AlertDialog><AlertDialogTrigger asChild><Button disabled={!props.selectedPaths.length || props.running} variant="destructive"><Trash2 />删除已选</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.data.dryRun ?? true ? "生成删除计划？" : "永久删除已选文件？"}</AlertDialogTitle><AlertDialogDescription>{props.data.dryRun ?? true ? "当前是预演模式，不会修改文件。" : `将永久删除 ${props.selectedPaths.length} 个路径，此操作不可撤销。`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void props.executeOperation("delete")}>确认</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>{props.data.operation ? <div className="rounded-md border bg-muted/30 p-2 text-xs"><div className="font-medium">上次操作</div><div className="mt-1 text-muted-foreground">{props.data.operation.affectedCount} 项 / {props.data.operation.errorCount} 错误</div></div> : null}</div></ScrollArea></section>
}

function StatusBar(props: View) { return <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/20 px-2 py-1"><Progress className="h-1.5 flex-1" value={props.data.progress ?? 0} /><span className="max-w-[55%] truncate text-[11px] text-muted-foreground">{props.data.progressText || "Czkawka 已就绪。"}</span>{props.data.phase === "error" ? <AlertTriangle className="size-3.5 text-destructive" /> : null}</div> }
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <div className="bg-card p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className={cn("mt-1 font-mono text-sm font-semibold", accent && "text-primary")}>{value}</div></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5"><Label className="text-xs">{label}</Label>{children}</label> }
function SwitchLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex items-center justify-between gap-2 rounded-md border bg-background/50 px-2 py-1.5 text-xs"><span>{label}</span><Switch checked={checked} size="sm" onCheckedChange={onChange} /></label> }
function SectionHeader({ icon, title }: { icon: typeof Search; title: string }) { return <div className="border-b px-3 py-2"><SectionTitle icon={icon} title={title} /></div> }
function SectionTitle({ icon: Icon, title }: { icon: typeof Search; title: string }) { return <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]"><Icon className="size-3.5 text-primary" />{title}</div> }

export function scanInput(tool: CzkawkaTool, data: CzkawkaCardState): CzkawkaInput { return createCzkawkaScanInput(tool, data as Record<string, unknown>) }
function filterGroups(result: CzkawkaData | null, filter: string, sort: CzkawkaSort, descending: boolean): CzkawkaData["groups"] { if (!result) return []; const needle = filter.trim().toLocaleLowerCase(); return result.groups.map((group) => ({ ...group, entries: [...group.entries].filter((entry) => !needle || `${entry.path} ${entry.detail ?? ""} ${entry.artist ?? ""} ${entry.title ?? ""}`.toLocaleLowerCase().includes(needle)).sort((a, b) => { const compared = sort === "size" ? a.size - b.size : sort === "modified" ? a.modifiedDate - b.modifiedDate : a.path.localeCompare(b.path, undefined, { numeric: true }); return descending ? -compared : compared }) })).filter((group) => group.entries.length) }
function toolMeta(tool: CzkawkaTool) { return TOOLS.find((item) => item.id === tool) ?? TOOLS[0]! }
function lines(value: unknown) { return String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
function message(error: unknown) { return error instanceof Error ? error.message : String(error) }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; const units = ["KB", "MB", "GB", "TB"]; let value = bytes / 1024, unit = units[0]!; for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]! } return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}` }
function getData(host: NodeComponentProps<CzkawkaCardState>["host"], compId: string): CzkawkaCardState { return host.state?.getData?.() ?? host.getData<CzkawkaCardState>(compId) ?? {} }
