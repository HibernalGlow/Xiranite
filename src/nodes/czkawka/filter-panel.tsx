import { useEffect, useRef, useState } from "react"
import type { CzkawkaBuiltinFilterPreset, CzkawkaFilterState, CzkawkaFilterStats, CzkawkaFormatCategory, CzkawkaMarkFilter, CzkawkaPathMatchMode, CzkawkaSizeUnit, CzkawkaStoredFilterPreset, CzkawkaTool } from "@xiranite/node-czkawka/filters"
import { applyCzkawkaBuiltinFilterPreset, countActiveCzkawkaFilters, createDefaultCzkawkaFilterState, parseCzkawkaFilterPresets, serializeCzkawkaFilterPresets, supportsResolutionFilter, supportsSimilarityFilter } from "@xiranite/node-czkawka/filters"
import { Filter, RotateCcw, Save, Trash2, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export interface CzkawkaFilterPanelProps {
  tool: CzkawkaTool
  state: CzkawkaFilterState
  stats: CzkawkaFilterStats
  pathPatternError?: string
  textPatternError?: string
  presets: CzkawkaStoredFilterPreset[]
  onChange: (state: CzkawkaFilterState) => void
  onPresetsChange: (presets: CzkawkaStoredFilterPreset[]) => void
}

export function CzkawkaFilterPanel(props: CzkawkaFilterPanelProps) {
  "use no memo"
  const active = countActiveCzkawkaFilters(props.state)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [selectedPreset, setSelectedPreset] = useState("none")
  const [presetName, setPresetName] = useState("")
  const [transferText, setTransferText] = useState("")
  const [presetError, setPresetError] = useState("")
  const patch = <K extends keyof CzkawkaFilterState>(key: K, value: CzkawkaFilterState[K]) => props.onChange({ ...props.state, [key]: value })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const surface = triggerRef.current?.closest('[data-testid="czkawka-surface"]')
      if (!open && surface && !surface.contains(document.activeElement)) return
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLocaleLowerCase() === "f") { event.preventDefault(); setOpen((value) => !value); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") { event.preventDefault(); setOpen(true); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "r") { event.preventDefault(); props.onChange({ ...props.state }); return }
      if (event.key === "Escape") { event.preventDefault(); props.onChange(createDefaultCzkawkaFilterState()); setOpen(false) }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, props.onChange, props.state])

  function choosePreset(value: string) {
    setSelectedPreset(value)
    if (isBuiltinPreset(value)) props.onChange(applyCzkawkaBuiltinFilterPreset(value))
    else { const preset = props.presets.find((item) => item.id === value); if (preset) props.onChange(preset.state) }
  }

  function savePreset() {
    const name = presetName.trim()
    if (!name) { setPresetError("请输入预设名称。"); return }
    const existing = props.presets.find((item) => item.name === name)
    const preset = { id: existing?.id ?? `filter-${Date.now()}`, name, state: props.state }
    props.onPresetsChange(existing ? props.presets.map((item) => item.id === existing.id ? preset : item) : [...props.presets, preset])
    setSelectedPreset(preset.id)
    setPresetName("")
    setPresetError("")
  }

  function importPresets() {
    try { const imported = parseCzkawkaFilterPresets(transferText); props.onPresetsChange(imported); setPresetError("") }
    catch (error) { setPresetError(error instanceof Error ? error.message : String(error)) }
  }

  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button ref={triggerRef} aria-label="打开多维筛选" size="sm" variant={active ? "secondary" : "outline"}><Filter />筛选{active ? <Badge variant="default">{active}</Badge> : null}</Button></PopoverTrigger><PopoverContent align="end" className="w-[min(94vw,520px)] p-0"><div className="flex items-center justify-between border-b px-3 py-2"><div><div className="text-sm font-semibold">多维筛选</div><div className="text-[11px] text-muted-foreground">{props.stats.filteredItems}/{props.stats.totalItems} 文件 · {props.stats.filteredGroups}/{props.stats.totalGroups} 组 · {formatBytes(props.stats.filteredBytes)}</div></div><Button size="xs" variant="ghost" onClick={() => props.onChange(createDefaultCzkawkaFilterState())}><RotateCcw />重置</Button></div><ScrollArea className="h-[min(68vh,620px)]"><div className="grid gap-3 p-3">
    <FilterSection label="筛选预设"><div className="grid grid-cols-[1fr_auto] gap-2"><Select value={selectedPreset} onValueChange={choosePreset}><SelectTrigger aria-label="筛选预设"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">无预设</SelectItem><SelectItem value="large-files">大文件（≥100 MB）</SelectItem><SelectItem value="small-files">小文件（≤1 MB）</SelectItem><SelectItem value="recently-modified">最近 30 天</SelectItem><SelectItem value="old-files">一年以前</SelectItem>{props.presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}</SelectContent></Select><Button aria-label="删除当前预设" disabled={isBuiltinPreset(selectedPreset)} size="icon-sm" variant="outline" onClick={() => { props.onPresetsChange(props.presets.filter((item) => item.id !== selectedPreset)); setSelectedPreset("none") }}><Trash2 /></Button></div><div className="flex gap-2"><Input aria-label="新预设名称" placeholder="预设名称" value={presetName} onChange={(event) => setPresetName(event.currentTarget.value)} /><Button size="sm" variant="outline" onClick={savePreset}><Save />保存</Button></div><div className="flex gap-2"><Button size="xs" variant="ghost" onClick={() => { setTransferText(serializeCzkawkaFilterPresets(props.presets)); setPresetError("") }}>导出 JSON</Button><Button size="xs" variant="ghost" onClick={importPresets}><Upload />导入 JSON</Button></div>{transferText ? <Textarea aria-label="预设 JSON" className="min-h-24 font-mono text-[10px]" value={transferText} onChange={(event) => setTransferText(event.currentTarget.value)} /> : null}{presetError ? <div role="alert" className="text-xs text-destructive">{presetError}</div> : null}</FilterSection>
    <FilterSection label="快速文本"><Enabled checked={props.state.text.enabled} label="启用文本筛选" onChange={(enabled) => patch("text", { ...props.state.text, enabled })} /><Input aria-label="快速文本模式" placeholder="名称、路径和媒体字段" value={props.state.text.pattern} onChange={(event) => patch("text", { ...props.state.text, enabled: Boolean(event.currentTarget.value), pattern: event.currentTarget.value })} /><div className="grid grid-cols-2 gap-2"><Enabled checked={props.state.text.regex} label="正则表达式" onChange={(regex) => patch("text", { ...props.state.text, regex })} /><Enabled checked={props.state.text.caseSensitive} label="区分大小写" onChange={(caseSensitive) => patch("text", { ...props.state.text, caseSensitive })} /></div>{props.textPatternError ? <div role="alert" className="text-xs text-destructive">正则无效：{props.textPatternError}</div> : null}</FilterSection>
    <FilterSection label="标记状态"><Select value={props.state.mark} onValueChange={(value) => patch("mark", value as CzkawkaMarkFilter)}><SelectTrigger aria-label="标记状态"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部</SelectItem><SelectItem value="selected">已选</SelectItem><SelectItem value="unselected">未选</SelectItem><SelectItem value="group-some-selected">组内部分已选</SelectItem><SelectItem value="group-all-selected">组内全部已选</SelectItem><SelectItem value="group-none-selected">组内均未选</SelectItem><SelectItem value="reference">仅参考项</SelectItem></SelectContent></Select></FilterSection>
    <div className="grid grid-cols-2 gap-2"><RangeSection label="组内数量" value={props.state.groupCount} onChange={(value) => patch("groupCount", value)} /><SizeRangeSection label="组总体积" value={props.state.groupSize} onChange={(value) => patch("groupSize", value)} /></div>
    <SizeRangeSection label="文件大小" value={props.state.fileSize} onChange={(value) => patch("fileSize", value)} />
    <FilterSection label="扩展名"><Enabled checked={props.state.extension.enabled} label="启用扩展名筛选" onChange={(enabled) => patch("extension", { ...props.state.extension, enabled })} /><div className="grid grid-cols-[120px_1fr] gap-2"><Select value={props.state.extension.mode} onValueChange={(mode) => patch("extension", { ...props.state.extension, mode: mode as "include" | "exclude" })}><SelectTrigger aria-label="扩展名模式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="include">仅包含</SelectItem><SelectItem value="exclude">排除</SelectItem></SelectContent></Select><Input aria-label="扩展名列表" placeholder="jpg, png, avif" value={props.state.extension.extensions.join(", ")} onChange={(event) => patch("extension", { ...props.state.extension, extensions: tokens(event.currentTarget.value) })} /></div><div className="flex flex-wrap gap-1">{props.stats.categories.map((item) => <Button key={item.category} aria-pressed={!props.state.extension.excludedCategories.includes(item.category)} size="xs" variant={props.state.extension.excludedCategories.includes(item.category) ? "outline" : "secondary"} onClick={() => toggleCategory(props, item.category)}>{categoryLabel(item.category)} <span className="opacity-70">{item.filteredCount}/{item.totalCount}</span></Button>)}</div><div className="flex flex-wrap gap-1">{props.stats.extensions.slice(0, 10).map((item) => <Button key={item.extension} size="xs" variant={props.state.extension.extensions.includes(item.extension) ? "default" : "outline"} onClick={() => toggleExtension(props, item.extension)}>{item.extension} <span className="opacity-70">{item.filteredCount}/{item.totalCount}</span></Button>)}</div></FilterSection>
    <FilterSection label="修改日期"><Enabled checked={props.state.modifiedDate.enabled} label="启用日期筛选" onChange={(enabled) => patch("modifiedDate", { ...props.state.modifiedDate, enabled })} /><Select value={props.state.modifiedDate.preset} onValueChange={(preset) => patch("modifiedDate", { ...props.state.modifiedDate, preset: preset as CzkawkaFilterState["modifiedDate"]["preset"] })}><SelectTrigger aria-label="日期范围"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">今天</SelectItem><SelectItem value="last-7-days">最近 7 天</SelectItem><SelectItem value="last-30-days">最近 30 天</SelectItem><SelectItem value="last-year">最近一年</SelectItem><SelectItem value="custom">自定义</SelectItem></SelectContent></Select>{props.state.modifiedDate.preset === "custom" ? <div className="grid grid-cols-2 gap-2"><Input aria-label="开始日期" type="date" value={dateInput(props.state.modifiedDate.start)} onChange={(event) => patch("modifiedDate", { ...props.state.modifiedDate, start: dateTimestamp(event.currentTarget.value) })} /><Input aria-label="结束日期" type="date" value={dateInput(props.state.modifiedDate.end)} onChange={(event) => patch("modifiedDate", { ...props.state.modifiedDate, end: endOfDateTimestamp(event.currentTarget.value) })} /></div> : null}</FilterSection>
    <FilterSection label="路径"><Enabled checked={props.state.path.enabled} label="启用路径筛选" onChange={(enabled) => patch("path", { ...props.state.path, enabled })} /><div className="grid grid-cols-[130px_1fr] gap-2"><Select value={props.state.path.mode} onValueChange={(mode) => patch("path", { ...props.state.path, mode: mode as CzkawkaPathMatchMode })}><SelectTrigger aria-label="路径匹配模式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contains">包含</SelectItem><SelectItem value="not-contains">不包含</SelectItem><SelectItem value="starts-with">开头是</SelectItem><SelectItem value="ends-with">结尾是</SelectItem><SelectItem value="regex">正则表达式</SelectItem></SelectContent></Select><Input aria-label="路径模式" value={props.state.path.pattern} onChange={(event) => patch("path", { ...props.state.path, pattern: event.currentTarget.value })} /></div><Enabled checked={props.state.path.caseSensitive} label="区分大小写" onChange={(caseSensitive) => patch("path", { ...props.state.path, caseSensitive })} />{props.pathPatternError ? <div role="alert" className="text-xs text-destructive">正则无效：{props.pathPatternError}</div> : null}</FilterSection>
    {supportsSimilarityFilter(props.tool) ? <RangeSection label="相似度（%）" value={props.state.similarity} onChange={(value) => patch("similarity", value)} /> : null}
    {supportsResolutionFilter(props.tool) ? <FilterSection label="分辨率 / 宽高比"><Enabled checked={props.state.resolution.enabled} label="启用分辨率筛选" onChange={(enabled) => patch("resolution", { ...props.state.resolution, enabled })} /><div className="grid grid-cols-2 gap-2"><NumberInput label="最小宽度" value={props.state.resolution.minWidth} onChange={(minWidth) => patch("resolution", { ...props.state.resolution, minWidth })} /><NumberInput label="最小高度" value={props.state.resolution.minHeight} onChange={(minHeight) => patch("resolution", { ...props.state.resolution, minHeight })} /><NumberInput label="最大宽度" value={props.state.resolution.maxWidth} onChange={(maxWidth) => patch("resolution", { ...props.state.resolution, maxWidth })} /><NumberInput label="最大高度" value={props.state.resolution.maxHeight} onChange={(maxHeight) => patch("resolution", { ...props.state.resolution, maxHeight })} /></div><Select value={props.state.resolution.aspectRatio} onValueChange={(aspectRatio) => patch("resolution", { ...props.state.resolution, aspectRatio: aspectRatio as CzkawkaFilterState["resolution"]["aspectRatio"] })}><SelectTrigger aria-label="宽高比"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">任意宽高比</SelectItem><SelectItem value="16:9">16:9</SelectItem><SelectItem value="4:3">4:3</SelectItem><SelectItem value="1:1">1:1</SelectItem></SelectContent></Select></FilterSection> : null}
    <Enabled checked={props.state.showAllInFilteredGroups} label="命中组显示全部文件" onChange={(showAllInFilteredGroups) => patch("showAllInFilteredGroups", showAllInFilteredGroups)} /><div className="text-[10px] text-muted-foreground">快捷键：Ctrl/Cmd+F 打开 · Ctrl/Cmd+Shift+F 切换 · Ctrl/Cmd+R 刷新 · Esc 重置</div>
  </div></ScrollArea></PopoverContent></Popover>
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) { return <section className="grid gap-2 rounded-md border p-2"><div className="text-xs font-semibold">{label}</div>{children}</section> }
function Enabled({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) { return <label className="flex items-center justify-between gap-2 text-xs"><span>{label}</span><Switch aria-label={label} checked={checked} size="sm" onCheckedChange={onChange} /></label> }
function NumberInput({ label, value, onChange }: { label: string; value?: number; onChange: (value?: number) => void }) { return <label className="grid gap-1 text-[11px] text-muted-foreground"><span>{label}</span><Input aria-label={label} type="number" min={0} value={value ?? ""} onChange={(event) => onChange(optionalNumber(event.currentTarget.value))} /></label> }
function RangeSection({ label, value, onChange }: { label: string; value: CzkawkaFilterState["groupCount"]; onChange: (value: CzkawkaFilterState["groupCount"]) => void }) { return <FilterSection label={label}><Enabled checked={value.enabled} label={`${label}筛选`} onChange={(enabled) => onChange({ ...value, enabled })} /><div className="grid grid-cols-2 gap-2"><NumberInput label={`${label}最小`} value={value.min} onChange={(min) => onChange({ ...value, min })} /><NumberInput label={`${label}最大`} value={value.max} onChange={(max) => onChange({ ...value, max })} /></div></FilterSection> }
function SizeRangeSection({ label, value, onChange }: { label: string; value: CzkawkaFilterState["fileSize"]; onChange: (value: CzkawkaFilterState["fileSize"]) => void }) { return <FilterSection label={label}><Enabled checked={value.enabled} label={`${label}筛选`} onChange={(enabled) => onChange({ ...value, enabled })} /><div className="grid grid-cols-[1fr_1fr_86px] gap-2"><NumberInput label={`${label}最小`} value={value.min} onChange={(min) => onChange({ ...value, min })} /><NumberInput label={`${label}最大`} value={value.max} onChange={(max) => onChange({ ...value, max })} /><label className="grid gap-1 text-[11px] text-muted-foreground"><span>单位</span><Select value={value.unit ?? "B"} onValueChange={(unit) => onChange({ ...value, unit: unit as CzkawkaSizeUnit })}><SelectTrigger aria-label={`${label}单位`}><SelectValue /></SelectTrigger><SelectContent>{["B", "KB", "MB", "GB", "TB"].map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select></label></div></FilterSection> }

function toggleExtension(props: CzkawkaFilterPanelProps, extension: string) { const current = props.state.extension.extensions; props.onChange({ ...props.state, extension: { ...props.state.extension, enabled: true, extensions: current.includes(extension) ? current.filter((item) => item !== extension) : [...current, extension] } }) }
function toggleCategory(props: CzkawkaFilterPanelProps, category: CzkawkaFormatCategory) { const current = props.state.extension.excludedCategories; props.onChange({ ...props.state, extension: { ...props.state.extension, enabled: true, excludedCategories: current.includes(category) ? current.filter((item) => item !== category) : [...current, category] } }) }
function categoryLabel(category: CzkawkaFormatCategory): string { return ({ images: "图片", videos: "视频", audio: "音频", documents: "文档", archives: "压缩包", folders: "文件夹", other: "其他" })[category] }
function tokens(value: string): string[] { return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim().replace(/^\./, "").toLocaleLowerCase()).filter(Boolean))] }
function optionalNumber(value: string): number | undefined { const number = Number(value); return value === "" || !Number.isFinite(number) ? undefined : number }
function dateInput(value: number | undefined): string { return value ? new Date(value).toISOString().slice(0, 10) : "" }
function dateTimestamp(value: string): number | undefined { return value ? new Date(`${value}T00:00:00`).getTime() : undefined }
function endOfDateTimestamp(value: string): number | undefined { return value ? new Date(`${value}T23:59:59.999`).getTime() : undefined }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; const units = ["KB", "MB", "GB", "TB"]; let value = bytes / 1024; let unit = units[0]!; for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]! } return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}` }
function isBuiltinPreset(value: string): value is CzkawkaBuiltinFilterPreset { return ["none", "large-files", "small-files", "recently-modified", "old-files"].includes(value) }
