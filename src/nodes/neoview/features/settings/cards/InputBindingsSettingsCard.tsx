/**
 * @migrated-from src/lib/cards/settings/BindingsSettingsCard.svelte
 * @migrated-from src/lib/components/dialogs/UnifiedBindingPanel.svelte
 * @source-hash sha256:669d0667f096ad915f38fe239e4e330039daf99242256c4bab6bcf5d63a658dc
 * @migration-status adapted
 *
 * Action-centered binding editor: the catalog is the primary axis; each action
 * owns N flat bindings (context + input). Domain model stays a flat bindings[].
 */
import {
  cloneReaderInputBindings,
  READER_INPUT_ACTION_CATEGORIES,
  READER_INPUT_ACTION_CATEGORY_LABELS,
  READER_INPUT_ACTION_LABELS,
  READER_INPUT_ACTION_METADATA,
  READER_INPUT_CONTEXT_LABELS,
  READER_INPUT_CONTEXTS,
  READER_VIEW_AREAS,
  readerInputConflicts,
  type ReaderInputAction,
  type ReaderInputActionCategory,
  type ReaderInputBinding,
  type ReaderInputBindingsConfig,
  type ReaderInputContext,
  type ReaderInputDescriptor,
} from "@xiranite/node-neoview/ui-core"
import {
  AlertTriangle,
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Eye,
  Film,
  FolderOpen,
  Gamepad2,
  Grid3X3,
  Hand,
  ImageUpscale,
  Keyboard,
  Layers,
  Mouse,
  Move,
  PanelRight,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  ToggleLeft,
  Trash2,
  Undo2,
  Video,
  X,
  ZoomIn,
  type LucideIcon,
} from "lucide-react"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"
import { useReaderKeyboardRecorder } from "../../input/useReaderKeyboardRecorder"
import { GUI_READER_INPUT_ACTIONS, GUI_READER_INPUT_ACTION_SET } from "../../input/ReaderInputActionCapabilities"

const LazyReaderDeviceInputRecorder = lazy(async () => ({
  default: (await import("../../input/ReaderDeviceInputRecorder")).ReaderDeviceInputRecorder,
}))
const LazyRadialMenuSettingsEditor = lazy(async () => ({
  default: (await import("./RadialMenuSettingsEditor")).RadialMenuSettingsEditor,
}))

type RecordableReaderDevice = Extract<ReaderInputDescriptor["device"], "mouse" | "mouse-gesture" | "wheel" | "touch" | "gamepad">
type DeviceKind = ReaderInputDescriptor["device"]

const DEVICE_OPTIONS: ReadonlyArray<{ value: DeviceKind; label: string; icon: LucideIcon }> = [
  { value: "keyboard", label: "键盘", icon: Keyboard },
  { value: "mouse", label: "鼠标", icon: Mouse },
  { value: "mouse-gesture", label: "鼠标轨迹", icon: Move },
  { value: "wheel", label: "滚轮", icon: CircleDot },
  { value: "touch", label: "触控", icon: Hand },
  { value: "gamepad", label: "手柄", icon: Gamepad2 },
  { value: "area", label: "九宫格区域", icon: Grid3X3 },
]

const CATEGORY_ICONS: Readonly<Record<ReaderInputActionCategory, LucideIcon>> = {
  navigation: BookOpen,
  zoom: ZoomIn,
  view: Eye,
  radial: Sparkles,
  file: FolderOpen,
  video: Film,
  upscale: ImageUpscale,
  slideshow: Play,
  "viewer-toggle": ToggleLeft,
  session: Settings2,
}

const CONTEXT_VISUAL: Readonly<Record<ReaderInputContext, { label: string; icon: LucideIcon; className: string }>> = {
  global: { label: "全局", icon: AppWindow, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  reader: { label: "阅读器", icon: BookOpen, className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  video: { label: "视频", icon: Video, className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  panel: { label: "面板", icon: PanelRight, className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  editor: { label: "编辑器", icon: Pencil, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  modal: { label: "对话框", icon: Layers, className: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300" },
}

export function InputBindingsSettingsCard({ inputBindings, onInputBindings, radialMenu, onRadialMenu }: ReaderSettingsCardContext) {
  if (!inputBindings || !onInputBindings) return null
  // Tabs root wraps the shell so the header actions (TabsList) share context with TabsContent.
  return (
    <Tabs defaultValue="bindings" className="w-full gap-0">
      <SettingsCardShell
        id="input-bindings-settings"
        title="操作绑定"
        description="快捷键与轮盘配置，写入 [nodes.neoview.bindings]。"
        icon={Keyboard}
        className="[&>header]:items-center"
        actions={
          <TabsList variant="default" layout="fit" aria-label="操作绑定分区" className="h-8">
            <TabsTrigger value="bindings" className="h-7 gap-1 px-2.5 text-xs">
              <Keyboard className="size-3.5" />
              快捷键
            </TabsTrigger>
            <TabsTrigger value="radial" className="h-7 gap-1 px-2.5 text-xs" disabled={!radialMenu || !onRadialMenu}>
              <Sparkles className="size-3.5" />
              轮盘
            </TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="bindings" className="mt-0 outline-none">
          <InputBindingsEditor value={inputBindings} onSave={onInputBindings} />
        </TabsContent>
        <TabsContent value="radial" className="mt-0 outline-none">
          {radialMenu && onRadialMenu ? (
            <Suspense fallback={null}>
              <LazyRadialMenuSettingsEditor value={radialMenu} onSave={onRadialMenu} />
            </Suspense>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">当前 Reader 未暴露轮盘配置接口。</p>
          )}
        </TabsContent>
      </SettingsCardShell>
    </Tabs>
  )
}

const AUTOSAVE_DELAY_MS = 220

export function InputBindingsEditor({
  value,
  onSave,
}: {
  value: ReaderInputBindingsConfig
  onSave(patch: { bindings?: ReaderInputBinding[]; reset?: "defaults" }): Promise<ReaderInputBindingsConfig>
}) {
  const [draft, setDraft] = useState(() => cloneReaderInputBindings(value))
  const [query, setQuery] = useState("")
  const [contextFilter, setContextFilter] = useState("all")
  const [category, setCategory] = useState<"all" | ReaderInputActionCategory>("all")
  const [selectedAction, setSelectedAction] = useState<ReaderInputAction | undefined>()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [adding, setAdding] = useState(false)
  const [deviceRecording, setDeviceRecording] = useState<{ id: string; device: RecordableReaderDevice }>()
  const recordingFocusRef = useRef<HTMLElement>()
  const addMenuRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()
  const skipNextValueSync = useRef(false)
  const saveQueueRef = useRef(Promise.resolve())
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    if (skipNextValueSync.current) {
      skipNextValueSync.current = false
      return
    }
    setDraft(cloneReaderInputBindings(value))
    setDirty(false)
  }, [value])

  useEffect(() => {
    if (!adding) return
    const onPointerDown = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAdding(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [adding])

  const applyDraft = useCallback((update: (current: ReaderInputBindingsConfig) => ReaderInputBindingsConfig) => {
    setDraft((current) => update(current))
    setDirty(true)
    setFeedback(undefined)
  }, [])

  const recordKeyboard = useCallback((id: string, input: Extract<ReaderInputDescriptor, { device: "keyboard" }>) => {
    applyDraft((current) => ({ bindings: current.bindings.map((binding) => binding.id === id ? { ...binding, input } : binding) }))
  }, [applyDraft])
  const { recordingId, toggleRecording, cancelRecording } = useReaderKeyboardRecorder(recordKeyboard)
  const activeRecordingId = recordingId ?? deviceRecording?.id
  const previousRecordingId = useRef<string>()
  useEffect(() => {
    const previous = previousRecordingId.current
    previousRecordingId.current = activeRecordingId
    if (previous && !activeRecordingId) {
      recordingFocusRef.current?.focus()
      recordingFocusRef.current = undefined
    }
  }, [activeRecordingId])

  const conflicts = useMemo(() => readerInputConflicts(draft.bindings), [draft.bindings])
  const conflictIds = useMemo(() => new Set(conflicts.flatMap((current) => current.bindingIds)), [conflicts])

  const bindingsByAction = useMemo(() => {
    const map = new Map<ReaderInputAction, ReaderInputBinding[]>()
    for (const binding of draft.bindings) {
      const list = map.get(binding.action) ?? []
      list.push(binding)
      map.set(binding.action, list)
    }
    return map
  }, [draft.bindings])

  const catalogActions = useMemo(() => {
    const known = new Set<ReaderInputAction>(GUI_READER_INPUT_ACTIONS)
    for (const binding of draft.bindings) known.add(binding.action)
    return [...known]
  }, [draft.bindings])

  const visibleActions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return catalogActions.filter((action) => {
      if (!GUI_READER_INPUT_ACTION_SET.has(action) && !(bindingsByAction.get(action)?.length)) return false
      const meta = READER_INPUT_ACTION_METADATA[action]
      if (!meta) return false
      if (category !== "all" && meta.category !== category) return false
      const actionBindings = bindingsByAction.get(action) ?? []
      if (contextFilter !== "all" && !actionBindings.some((binding) => binding.context === contextFilter)) {
        if (actionBindings.length > 0) return false
        return false
      }
      if (!search) return true
      const chipText = actionBindings.map((binding) => `${READER_INPUT_CONTEXT_LABELS[binding.context]} ${formatInputSummary(binding.input)}`).join(" ")
      return `${READER_INPUT_ACTION_LABELS[action]} ${READER_INPUT_ACTION_CATEGORY_LABELS[meta.category]} ${action} ${chipText}`.toLocaleLowerCase().includes(search)
    })
  }, [bindingsByAction, catalogActions, category, contextFilter, query])

  const actionsByCategory = useMemo(() => {
    const groups: { category: ReaderInputActionCategory | "other"; label: string; actions: ReaderInputAction[] }[] = []
    const seen = new Set<ReaderInputAction>()
    for (const item of READER_INPUT_ACTION_CATEGORIES) {
      const actions = visibleActions.filter((action) => READER_INPUT_ACTION_METADATA[action]?.category === item)
      for (const action of actions) seen.add(action)
      if (actions.length) groups.push({ category: item, label: READER_INPUT_ACTION_CATEGORY_LABELS[item], actions })
    }
    const missing = visibleActions.filter((action) => !seen.has(action))
    if (missing.length) groups.push({ category: "other", label: "其他", actions: missing })
    return groups
  }, [visibleActions])

  useEffect(() => {
    setSelectedAction((current) => {
      if (current && visibleActions.includes(current)) return current
      return visibleActions.find((action) => (bindingsByAction.get(action)?.length ?? 0) > 0) ?? visibleActions[0]
    })
  }, [bindingsByAction, visibleActions])

  const selectedBindings = useMemo(() => {
    if (!selectedAction) return [] as ReaderInputBinding[]
    const list = bindingsByAction.get(selectedAction) ?? []
    if (contextFilter === "all") return list
    return list.filter((binding) => binding.context === contextFilter)
  }, [bindingsByAction, contextFilter, selectedAction])

  const previousSelectedAction = useRef<ReaderInputAction | undefined>()
  useEffect(() => {
    if (!selectedAction) return
    if (previousSelectedAction.current === selectedAction) return
    previousSelectedAction.current = selectedAction
    cancelRecording()
    setDeviceRecording(undefined)
    const ids = (bindingsByAction.get(selectedAction) ?? []).map((binding) => binding.id)
    setExpandedIds(new Set(ids))
    setAdding(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expand on action switch only
  }, [selectedAction])

  // Live autosave: persist draft shortly after each edit when conflict-free.
  useEffect(() => {
    if (!dirty || conflicts.length || activeRecordingId) return
    const timer = window.setTimeout(() => {
      const bindings = draftRef.current.bindings
      if (readerInputConflicts(bindings).length) return
      setSaving(true)
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const updated = await onSave({ bindings })
          skipNextValueSync.current = true
          setDraft(cloneReaderInputBindings(updated))
          setDirty(false)
          setFeedback({ kind: "status", text: "操作绑定已自动保存。" })
        } catch (error) {
          setFeedback({ kind: "alert", text: errorMessage(error) })
        } finally {
          setSaving(false)
        }
      })
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [activeRecordingId, conflicts.length, dirty, draft.bindings, onSave])

  function replace(id: string, update: (current: ReaderInputBinding) => ReaderInputBinding) {
    applyDraft((current) => ({ bindings: current.bindings.map((binding) => binding.id === id ? update(binding) : binding) }))
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addBinding(device: DeviceKind = "keyboard") {
    if (!selectedAction) return
    cancelRecording()
    setDeviceRecording(undefined)
    const created = newBinding(draftRef.current.bindings, selectedAction, device)
    applyDraft((current) => ({ bindings: [...current.bindings, created] }))
    setExpandedIds((current) => new Set(current).add(created.id))
    setAdding(false)
    // Only keyboard auto-starts capture; other devices keep the expanded editor so autosave is not blocked.
    if (device === "keyboard") queueMicrotask(() => toggleRecording(created.id))
  }

  async function resetDefaults() {
    if (saving) return
    cancelRecording()
    setDeviceRecording(undefined)
    setSaving(true)
    setFeedback(undefined)
    try {
      const updated = await onSave({ reset: "defaults" })
      skipNextValueSync.current = true
      setDraft(cloneReaderInputBindings(updated))
      setDirty(false)
      setFeedback({ kind: "status", text: "已恢复默认绑定。" })
    } catch (error) {
      setFeedback({ kind: "alert", text: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const selectedMeta = selectedAction ? READER_INPUT_ACTION_METADATA[selectedAction] : undefined
  const selectedLabel = selectedAction ? READER_INPUT_ACTION_LABELS[selectedAction] : undefined
  const saveLabel = conflicts.length ? "存在冲突" : saving ? "保存中…" : dirty ? "待保存" : "已自动保存"

  return (
    <div className="grid gap-4" data-neoview-settings-card="input-bindings" data-input-context="modal">
      <header className="flex flex-wrap items-center justify-end gap-2">
        <span role="status" className={`mr-auto text-xs ${conflicts.length ? "text-destructive" : "text-muted-foreground"}`}>{saveLabel}</span>
        <Button type="button" size="sm" variant="outline" disabled={saving || Boolean(activeRecordingId)} onClick={() => void resetDefaults()}><RotateCcw />恢复默认</Button>
      </header>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索动作、分类、上下文或输入" aria-label="搜索操作绑定" />
        </label>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={category} onChange={(event) => setCategory(event.currentTarget.value as typeof category)} aria-label="筛选动作分类">
          <option value="all">全部分类</option>
          {READER_INPUT_ACTION_CATEGORIES.map((item) => <option key={item} value={item}>{READER_INPUT_ACTION_CATEGORY_LABELS[item]}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={contextFilter} onChange={(event) => setContextFilter(event.currentTarget.value)} aria-label="筛选上下文">
          <option value="all">全部上下文</option>
          {READER_INPUT_CONTEXTS.map((item) => <option key={item} value={item}>{READER_INPUT_CONTEXT_LABELS[item]}</option>)}
        </select>
      </div>

      {recordingId ? (
        <div role="status" className="flex items-center gap-2 rounded border border-primary/50 bg-primary/10 px-3 py-2 text-xs">
          <Radio className="size-4 animate-pulse" />请按下组合键；按 Escape 取消录制。
          <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={cancelRecording}><X />取消</Button>
        </div>
      ) : null}
      {deviceRecording ? (
        <Suspense fallback={null}>
          <LazyReaderDeviceInputRecorder
            device={deviceRecording.device}
            onCancel={() => setDeviceRecording(undefined)}
            onRecord={(input) => {
              replace(deviceRecording.id, (binding) => ({ ...binding, input }))
              setDeviceRecording(undefined)
            }}
          />
        </Suspense>
      ) : null}
      {conflicts.length ? (
        <div role="alert" className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />存在 {conflicts.length} 个同上下文输入冲突；禁用、删除或修改冲突项后才会继续自动保存。
        </div>
      ) : null}

      <div className="grid min-h-[28rem] gap-3 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <nav className="flex max-h-[36rem] flex-col overflow-hidden rounded-md border bg-muted/10" aria-label="动作目录">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            <Layers className="size-3.5" />
            动作
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="可选动作" aria-activedescendant={selectedAction ? actionOptionId(selectedAction) : undefined}>
            {actionsByCategory.map((group) => {
              const CategoryIcon = group.category === "other" ? Layers : CATEGORY_ICONS[group.category]
              return (
                <div key={group.category} className="mb-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    <CategoryIcon className="size-3.5 shrink-0 opacity-80" />
                    {group.label}
                  </div>
                  <ul className="grid gap-0.5">
                    {group.actions.map((action) => {
                      const actionBindings = bindingsByAction.get(action) ?? []
                      const selected = action === selectedAction
                      const hasConflict = actionBindings.some((binding) => conflictIds.has(binding.id))
                      const ActionIcon = CATEGORY_ICONS[READER_INPUT_ACTION_METADATA[action]?.category ?? "session"] ?? Layers
                      return (
                        <li key={action}>
                          <button
                            type="button"
                            id={actionOptionId(action)}
                            role="option"
                            aria-selected={selected}
                            data-action={action}
                            className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${selected ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/20" : "hover:bg-muted/70"} ${hasConflict ? "ring-1 ring-destructive/60" : ""}`}
                            onClick={() => setSelectedAction(action)}
                          >
                            <span className={`grid size-7 place-items-center rounded-md ${selected ? "bg-primary/20" : "bg-muted/70"}`}>
                              <ActionIcon className="size-3.5" />
                            </span>
                            <span className="min-w-0 truncate font-medium">{READER_INPUT_ACTION_LABELS[action] ?? action}</span>
                            <ActionBindingChips bindings={actionBindings} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
            {!visibleActions.length ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">没有匹配的动作</p> : null}
          </div>
        </nav>

        <div className="grid content-start gap-3 rounded-md border bg-card/40 p-3">
          {selectedAction && selectedMeta && selectedLabel ? (
            <>
              <div className="flex flex-wrap items-start gap-3 border-b pb-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  {(() => {
                    const Icon = CATEGORY_ICONS[selectedMeta.category]
                    return <Icon className="size-5" />
                  })()}
                </span>
                <div className="mr-auto grid min-w-0 gap-1">
                  <h3 className="text-base font-semibold">{selectedLabel}</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="gap-1 font-normal">
                      {(() => {
                        const Icon = CATEGORY_ICONS[selectedMeta.category]
                        return <Icon className="size-3" />
                      })()}
                      {READER_INPUT_ACTION_CATEGORY_LABELS[selectedMeta.category]}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[10px] font-normal text-muted-foreground">{selectedAction}</Badge>
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {selectedBindings.length ? `${selectedBindings.length} 条绑定` : "尚未绑定"}
                    </Badge>
                  </div>
                </div>
                <div className="relative" ref={addMenuRef}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (activeRecordingId) {
                        cancelRecording()
                        setDeviceRecording(undefined)
                      }
                      setAdding((current) => !current)
                    }}
                    aria-expanded={adding}
                    aria-label="添加绑定"
                  >
                    <Plus />添加绑定
                  </Button>
                  {adding ? (
                    <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md" role="menu" aria-label="选择输入设备">
                      {DEVICE_OPTIONS.map((device) => {
                        const Icon = device.icon
                        return (
                          <button
                            key={device.value}
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                            onClick={() => addBinding(device.value)}
                          >
                            <Icon className="size-3.5 text-muted-foreground" />
                            {device.label}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2" role="list" aria-label="操作绑定列表">
                {selectedBindings.map((binding) => (
                  <BindingRow
                    key={binding.id}
                    binding={binding}
                    conflicted={conflictIds.has(binding.id)}
                    disabled={saving || Boolean(activeRecordingId && activeRecordingId !== binding.id)}
                    recording={activeRecordingId === binding.id}
                    expanded={expandedIds.has(binding.id)}
                    onToggleExpand={() => toggleExpanded(binding.id)}
                    onRecord={(event) => {
                      recordingFocusRef.current = event.currentTarget
                      if (binding.input.device === "keyboard") toggleRecording(binding.id)
                      else if (binding.input.device !== "area") setDeviceRecording((current) => current?.id === binding.id ? undefined : { id: binding.id, device: binding.input.device })
                    }}
                    onChange={(next) => replace(binding.id, () => next)}
                    onRemove={() => applyDraft((current) => ({ bindings: current.bindings.filter((item) => item.id !== binding.id) }))}
                    onDuplicateToContext={(context) => {
                      const created = {
                        ...binding,
                        id: uniqueBindingId(draftRef.current.bindings, `${binding.id}-${context}`),
                        context,
                        enabled: binding.enabled,
                        input: { ...binding.input },
                      } satisfies ReaderInputBinding
                      applyDraft((current) => ({ bindings: [...current.bindings, created] }))
                      setExpandedIds((current) => new Set(current).add(created.id))
                    }}
                  />
                ))}
                {!selectedBindings.length ? (
                  <div className="grid place-items-center gap-3 rounded-xl border border-dashed bg-muted/15 px-4 py-10 text-center">
                    <span className="grid size-12 place-items-center rounded-2xl bg-muted/60 text-muted-foreground"><Keyboard className="size-5" /></span>
                    <p className="text-sm text-muted-foreground">此动作还没有绑定。选择设备后开始录制。</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {DEVICE_OPTIONS.slice(0, 4).map((device) => {
                        const Icon = device.icon
                        return (
                          <Button key={device.value} type="button" size="sm" variant="outline" onClick={() => addBinding(device.value)}>
                            <Icon />{device.label}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">选择左侧动作以查看或添加绑定</p>
          )}
        </div>
      </div>

      {feedback ? <p role={feedback.kind} className={feedback.kind === "alert" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{feedback.text}</p> : null}
    </div>
  )
}

function ActionBindingChips({ bindings }: { bindings: readonly ReaderInputBinding[] }) {
  if (!bindings.length) {
    return <span className="text-[10px] text-muted-foreground/80">—</span>
  }
  const enabled = bindings.filter((binding) => binding.enabled)
  const preview = (enabled.length ? enabled : bindings).slice(0, 3)
  const extra = bindings.length - preview.length
  return (
    <span className="flex max-w-[9.5rem] flex-wrap justify-end gap-1">
      {preview.map((binding) => {
        const DeviceIcon = deviceIcon(binding.input.device)
        return (
          <span
            key={binding.id}
            title={`${READER_INPUT_CONTEXT_LABELS[binding.context]} · ${formatInputSummary(binding.input)}`}
            className={`inline-flex max-w-[4.75rem] items-center gap-0.5 truncate rounded-md border border-border/60 bg-background/80 px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground ${binding.enabled ? "" : "line-through opacity-50"}`}
          >
            <DeviceIcon className="size-2.5 shrink-0 opacity-70" />
            <span className="truncate">{formatInputChip(binding.input)}</span>
          </span>
        )
      })}
      {extra > 0 ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{extra}</span> : null}
    </span>
  )
}

function BindingRow({
  binding,
  conflicted,
  disabled,
  recording,
  expanded,
  onToggleExpand,
  onRecord,
  onChange,
  onRemove,
  onDuplicateToContext,
}: {
  binding: ReaderInputBinding
  conflicted: boolean
  disabled: boolean
  recording: boolean
  expanded: boolean
  onToggleExpand(): void
  onRecord(event: MouseEvent<HTMLButtonElement>): void
  onChange(binding: ReaderInputBinding): void
  onRemove(): void
  onDuplicateToContext(context: ReaderInputContext): void
}) {
  const DeviceIcon = deviceIcon(binding.input.device)
  const contextVisual = CONTEXT_VISUAL[binding.context]
  const ContextIcon = contextVisual.icon
  const summary = `${READER_INPUT_CONTEXT_LABELS[binding.context]} · ${formatInputSummary(binding.input)}`
  return (
    <div
      role="listitem"
      className={`grid gap-2 rounded-xl border px-3 py-2.5 shadow-sm transition-colors ${conflicted ? "border-destructive/70 bg-destructive/5" : "border-border/70 bg-background/60"} ${recording ? "ring-2 ring-primary/40" : ""}`}
      data-binding-id={binding.id}
    >
      <div className="grid gap-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center">
        <Switch checked={binding.enabled} disabled={disabled} onCheckedChange={(enabled) => onChange({ ...binding, enabled })} aria-label={`${READER_INPUT_ACTION_LABELS[binding.action]}启用`} />
        <Button type="button" size="icon-sm" variant="ghost" disabled={disabled && !recording} onClick={onToggleExpand} aria-expanded={expanded} aria-label={expanded ? "收起绑定详情" : "展开绑定详情"}>
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={onToggleExpand} title={summary}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/70 text-foreground">
            <DeviceIcon className="size-4" />
          </span>
          <span className="min-w-0 grid gap-1">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <kbd className="inline-flex max-w-full items-center truncate rounded-md border border-border/80 bg-muted/50 px-2 py-0.5 font-mono text-xs font-semibold tracking-wide">
                {formatInputSummary(binding.input)}
              </kbd>
              {conflicted ? <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">冲突</Badge> : null}
              {recording ? <Badge className="h-5 gap-1 px-1.5 text-[10px]"><Radio className="size-2.5 animate-pulse" />录制中</Badge> : null}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${contextVisual.className}`}>
                <ContextIcon className="size-3" />
                {contextVisual.label}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <DeviceIcon className="size-3 opacity-70" />
                {deviceOptionLabel(binding.input.device)}
              </span>
            </span>
          </span>
        </button>
        <div className="flex items-center justify-end gap-1">
          <label className="sr-only" htmlFor={`binding-context-${binding.id}`}>上下文</label>
          <div className="relative">
            <ContextIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <select
              id={`binding-context-${binding.id}`}
              className="h-8 appearance-none rounded-md border border-input bg-background py-0 pl-7 pr-6 text-xs"
              value={binding.context}
              disabled={disabled}
              onChange={(event) => onChange({ ...binding, context: event.currentTarget.value as ReaderInputBinding["context"] })}
              aria-label="上下文"
            >
              {READER_INPUT_CONTEXTS.map((item) => <option key={item} value={item}>{READER_INPUT_CONTEXT_LABELS[item]}</option>)}
            </select>
          </div>
          <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={onRemove} title="删除绑定" aria-label={`删除${READER_INPUT_ACTION_LABELS[binding.action]}绑定`}><Trash2 /></Button>
        </div>
      </div>

      {expanded ? (
        <div className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-3">
          <InputDescriptorEditor input={binding.input} disabled={disabled} recording={recording} onRecord={onRecord} onChange={(input) => onChange({ ...binding, input })} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Copy className="size-3" />复制到</span>
            {READER_INPUT_CONTEXTS.filter((context) => context !== binding.context).map((context) => {
              const visual = CONTEXT_VISUAL[context]
              const Icon = visual.icon
              return (
                <Button key={context} type="button" size="xs" variant="outline" className="gap-1" disabled={disabled} onClick={() => onDuplicateToContext(context)}>
                  <Icon className="size-3" />
                  {visual.label}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function InputDescriptorEditor({ input, disabled, recording, onRecord, onChange }: {
  input: ReaderInputDescriptor
  disabled: boolean
  recording: boolean
  onRecord(event: MouseEvent<HTMLButtonElement>): void
  onChange(input: ReaderInputDescriptor): void
}) {
  const DeviceIcon = deviceIcon(input.device)
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-muted/70"><DeviceIcon className="size-3.5" /></span>
        <select className="h-8 min-w-[7.5rem] rounded border border-input bg-background px-1 text-xs" value={input.device} disabled={disabled || recording} onChange={(event) => onChange(defaultInput(event.currentTarget.value as ReaderInputDescriptor["device"]))} aria-label="输入设备">
          {DEVICE_OPTIONS.map((device) => <option key={device.value} value={device.value}>{device.label}</option>)}
        </select>
      </div>
      {input.device === "keyboard" ? <KeyboardInputEditor input={input} disabled={disabled} recording={recording} onRecord={onRecord} onChange={onChange} /> : null}
      {input.device !== "keyboard" ? <div className="grid gap-1">
        {input.device === "mouse" ? <MouseInputEditor input={input} disabled={disabled || recording} onChange={onChange} /> : null}
        {input.device === "mouse-gesture" ? <MouseGestureInputEditor input={input} disabled={disabled || recording} onChange={onChange} /> : null}
        {input.device === "wheel" ? <div className="grid gap-1"><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.direction} disabled={disabled || recording} onChange={(event) => onChange({ ...input, direction: event.currentTarget.value as typeof input.direction })} aria-label="滚轮方向"><option value="up">向上</option><option value="down">向下</option></select><ModifierEditor input={input} disabled={disabled || recording} onChange={onChange} /></div> : null}
        {input.device === "touch" ? <TouchInputEditor input={input} disabled={disabled || recording} onChange={onChange} /> : null}
        {input.device === "gamepad" ? <Input className="h-8 text-xs" type="number" min={0} max={31} value={input.button} disabled={disabled || recording} onChange={(event) => onChange({ ...input, button: Number(event.currentTarget.value) })} aria-label="手柄按钮编号" /> : null}
        {input.device === "area" ? <AreaInputEditor input={input} disabled={disabled} onChange={onChange} /> : null}
        {input.device !== "area" ? <Button type="button" size="sm" variant={recording ? "default" : "outline"} disabled={disabled && !recording} onClick={onRecord} aria-label={recording ? `取消录制${deviceLabel(input.device)}` : `录制${deviceLabel(input.device)}`}><Radio />{recording ? "录制中" : "录制"}</Button> : null}
      </div> : null}
    </div>
  )
}

function MouseInputEditor({ input, disabled, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "mouse" }>
  disabled: boolean
  onChange(input: ReaderInputDescriptor): void
}) {
  return <div className="grid gap-1"><div className="grid grid-cols-2 gap-1"><MouseButtonSelect value={input.button} disabled={disabled} onChange={(button) => onChange({ ...input, button })} /><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.action} disabled={disabled} onChange={(event) => {
    const action = event.currentTarget.value as typeof input.action
    onChange(action === "hold" ? { ...input, action, durationMs: input.durationMs ?? 500, moveTolerancePx: input.moveTolerancePx ?? 12 } : { device: "mouse", button: input.button, action })
  }} aria-label="鼠标动作"><option value="click">单击</option><option value="double-click">双击</option><option value="press">按下</option><option value="hold">长按</option></select></div>{input.action === "hold" ? <TimingEditor input={input} disabled={disabled} onChange={onChange} /> : null}</div>
}

function MouseGestureInputEditor({ input, disabled, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "mouse-gesture" }>
  disabled: boolean
  onChange(input: ReaderInputDescriptor): void
}) {
  const directions = [
    { value: "left", label: "向左", icon: ArrowLeft },
    { value: "right", label: "向右", icon: ArrowRight },
    { value: "up", label: "向上", icon: ArrowUp },
    { value: "down", label: "向下", icon: ArrowDown },
  ] as const
  return <div className="grid gap-1"><div className="grid grid-cols-2 gap-1"><MouseButtonSelect value={input.button} disabled={disabled} onChange={(button) => onChange({ ...input, button })} /><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.trigger} disabled={disabled} onChange={(event) => {
    const trigger = event.currentTarget.value as typeof input.trigger
    onChange(trigger === "hold" ? { ...input, trigger, durationMs: input.durationMs ?? 500, moveTolerancePx: input.moveTolerancePx ?? 12 } : { device: "mouse-gesture", button: input.button, directions: input.directions, trigger })
  }} aria-label="轨迹触发方式"><option value="instant">释放时触发</option><option value="hold">轨迹后长按</option></select></div><div className="flex min-w-0 items-center gap-1" aria-label="鼠标轨迹方向序列"><code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">{input.directions.map(directionShortLabel).join(" ")}</code>{directions.map(({ value, label, icon: Icon }) => <Button key={value} type="button" size="icon-xs" variant="outline" disabled={disabled || input.directions.length >= 16 || input.directions.at(-1) === value} onClick={() => onChange({ ...input, directions: [...input.directions, value] })} title={label} aria-label={`添加${label}`}><Icon /></Button>)}<Button type="button" size="icon-xs" variant="ghost" disabled={disabled || input.directions.length <= 1} onClick={() => onChange({ ...input, directions: input.directions.slice(0, -1) })} title="移除最后方向" aria-label="移除最后方向"><Undo2 /></Button></div>{input.trigger === "hold" ? <TimingEditor input={input} disabled={disabled} onChange={onChange} /> : null}</div>
}

function TouchInputEditor({ input, disabled, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "touch" }>
  disabled: boolean
  onChange(input: ReaderInputDescriptor): void
}) {
  return <div className="grid gap-1"><div className="grid grid-cols-[1fr_5rem] gap-1"><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.gesture} disabled={disabled} onChange={(event) => {
    const gesture = event.currentTarget.value as typeof input.gesture
    onChange(gesture === "long-press" ? { ...input, gesture, durationMs: input.durationMs ?? 500, moveTolerancePx: input.moveTolerancePx ?? 12 } : { device: "touch", gesture, fingers: input.fingers })
  }} aria-label="触控手势"><option value="swipe-left">左滑</option><option value="swipe-right">右滑</option><option value="swipe-up">上滑</option><option value="swipe-down">下滑</option><option value="tap">点击</option><option value="long-press">长按</option></select><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.fingers} disabled={disabled} onChange={(event) => onChange({ ...input, fingers: Number(event.currentTarget.value) as 1 | 2 | 3 })} aria-label="触控手指数"><option value={1}>1 指</option><option value={2}>2 指</option><option value={3}>3 指</option></select></div>{input.gesture === "long-press" ? <TimingEditor input={input} disabled={disabled} onChange={onChange} /> : null}</div>
}

function MouseButtonSelect({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(button: number): void }) {
  return <select className="h-8 rounded border border-input bg-background px-1 text-xs" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.currentTarget.value))} aria-label="鼠标按钮">{Array.from({ length: 8 }, (_, button) => <option key={button} value={button}>{mouseButtonLabel(button)}</option>)}</select>
}

function TimingEditor<T extends Extract<ReaderInputDescriptor, { device: "mouse" | "mouse-gesture" | "touch" }>>({ input, disabled, onChange }: { input: T; disabled: boolean; onChange(input: T): void }) {
  return <div className="grid grid-cols-2 gap-1"><label className="grid gap-0.5 text-[10px] text-muted-foreground">持续毫秒<Input className="h-8 text-xs" type="number" min={100} max={5000} value={input.durationMs ?? 500} disabled={disabled} onChange={(event) => onChange({ ...input, durationMs: Number(event.currentTarget.value) })} /></label><label className="grid gap-0.5 text-[10px] text-muted-foreground">移动容差<Input className="h-8 text-xs" type="number" min={1} max={100} value={input.moveTolerancePx ?? 12} disabled={disabled} onChange={(event) => onChange({ ...input, moveTolerancePx: Number(event.currentTarget.value) })} /></label></div>
}

function directionShortLabel(direction: Extract<ReaderInputDescriptor, { device: "mouse-gesture" }>["directions"][number]): string {
  return direction === "left" ? "L" : direction === "right" ? "R" : direction === "up" ? "U" : "D"
}

function KeyboardInputEditor({ input, disabled, recording, onRecord, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "keyboard" }>
  disabled: boolean
  recording: boolean
  onRecord(event: MouseEvent<HTMLButtonElement>): void
  onChange(input: ReaderInputDescriptor): void
}) {
  return <div className="grid gap-1">
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-1">
      <Input className="h-8 text-xs" value={input.code} disabled={disabled || recording} onChange={(event) => onChange({ ...input, code: event.currentTarget.value })} aria-label="键盘代码" />
      <select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.trigger ?? "down"} disabled={disabled || recording} onChange={(event) => onChange(event.currentTarget.value === "hold" ? { ...input, trigger: "hold", durationMs: input.durationMs ?? 450 } : { device: "keyboard", code: input.code, ctrl: input.ctrl, alt: input.alt, shift: input.shift, meta: input.meta })} aria-label="键盘触发方式"><option value="down">按下</option><option value="hold">长按</option></select>
      <Button type="button" size="sm" variant={recording ? "default" : "outline"} disabled={disabled && !recording} onClick={onRecord} aria-label={recording ? "取消录制键盘输入" : "录制键盘输入"}><Radio />{recording ? "录制中" : "录制"}</Button>
    </div>
    <ModifierEditor input={input} disabled={disabled || recording} onChange={onChange} />
    {input.trigger === "hold" ? <label className="grid gap-0.5 text-[10px] text-muted-foreground">长按毫秒<Input className="h-8 text-xs" type="number" min={100} max={5000} value={input.durationMs ?? 450} disabled={disabled || recording} onChange={(event) => onChange({ ...input, durationMs: Number(event.currentTarget.value) })} /></label> : null}
  </div>
}

function ModifierEditor<T extends Extract<ReaderInputDescriptor, { device: "keyboard" | "wheel" }>>({ input, disabled, onChange }: { input: T; disabled: boolean; onChange(input: T): void }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{(["ctrl", "alt", "shift", "meta"] as const).map((key) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(input[key])} disabled={disabled} onChange={(event) => onChange({ ...input, [key]: event.currentTarget.checked || undefined })} />{modifierLabel(key)}</label>)}</div>
}

function AreaInputEditor({ input, disabled, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "area" }>
  disabled: boolean
  onChange(input: ReaderInputDescriptor): void
}) {
  return <div className="grid gap-2"><div className="grid aspect-[3/2] grid-cols-3 gap-1" aria-label="九宫格区域">{READER_VIEW_AREAS.map((area) => <button key={area} type="button" className={`min-h-8 rounded border text-[10px] ${input.area === area ? "border-primary bg-primary/15 text-primary" : "border-border bg-muted/30"}`} disabled={disabled} onClick={() => onChange({ ...input, area })} aria-pressed={input.area === area}>{areaLabel(area)}</button>)}</div><div className="grid grid-cols-2 gap-1"><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.button} disabled={disabled} onChange={(event) => onChange({ ...input, button: Number(event.currentTarget.value) as 0 | 1 | 2 })} aria-label="区域鼠标按钮"><option value={0}>左键</option><option value={1}>中键</option><option value={2}>右键</option></select><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.action} disabled={disabled} onChange={(event) => onChange({ ...input, action: event.currentTarget.value as typeof input.action })} aria-label="区域点击方式"><option value="click">单击</option><option value="double-click">双击</option><option value="press">按下</option></select></div></div>
}

function newBinding(bindings: readonly ReaderInputBinding[], action: ReaderInputAction, device: DeviceKind = "keyboard"): ReaderInputBinding {
  return {
    id: uniqueBindingId(bindings, `custom-${action}`),
    action,
    context: defaultContextForAction(action),
    enabled: true,
    input: defaultInput(device),
  }
}

function uniqueBindingId(bindings: readonly ReaderInputBinding[], prefix: string): string {
  const safe = prefix.replace(/[^a-zA-Z0-9._-]+/g, "-")
  let sequence = 1
  while (bindings.some((current) => current.id === `${safe}-${sequence}`)) sequence += 1
  return `${safe}-${sequence}`
}

function defaultContextForAction(action: ReaderInputAction): ReaderInputContext {
  if (action.startsWith("video.")) return "video"
  if (action.startsWith("shell.") || action.startsWith("viewer.")) return "reader"
  if (action.startsWith("file.") || action === "reader.open-settings") return "global"
  if (action.startsWith("radial.")) return "reader"
  return "reader"
}

function defaultInput(device: ReaderInputDescriptor["device"]): ReaderInputDescriptor {
  if (device === "keyboard") return { device, code: "KeyN" }
  if (device === "mouse") return { device, button: 3, action: "click" }
  if (device === "mouse-gesture") return { device, button: 2, directions: ["left"], trigger: "instant" }
  if (device === "wheel") return { device, direction: "down" }
  if (device === "touch") return { device, gesture: "swipe-left", fingers: 1 }
  if (device === "gamepad") return { device, button: 5 }
  return { device, area: "middle-center", button: 0, action: "click" }
}

function mouseButtonLabel(button: number): string {
  if (button === 0) return "左键 (0)"
  if (button === 1) return "中键 (1)"
  if (button === 2) return "右键 (2)"
  return `扩展键 ${button}`
}

function modifierLabel(key: "ctrl" | "alt" | "shift" | "meta"): string {
  return key === "ctrl" ? "Ctrl" : key === "alt" ? "Alt" : key === "shift" ? "Shift" : "Meta"
}

function deviceLabel(device: RecordableReaderDevice): string {
  return device === "mouse" ? "鼠标输入" : device === "mouse-gesture" ? "鼠标轨迹" : device === "wheel" ? "滚轮输入" : device === "touch" ? "触控手势" : "手柄按钮"
}

function deviceOptionLabel(device: DeviceKind): string {
  return DEVICE_OPTIONS.find((option) => option.value === device)?.label ?? device
}

function deviceIcon(device: DeviceKind): LucideIcon {
  return DEVICE_OPTIONS.find((option) => option.value === device)?.icon ?? Keyboard
}

function areaLabel(area: typeof READER_VIEW_AREAS[number]): string {
  const labels = { "top-left": "左上", "top-center": "中上", "top-right": "右上", "middle-left": "左中", "middle-center": "中心", "middle-right": "右中", "bottom-left": "左下", "bottom-center": "中下", "bottom-right": "右下" } as const
  return labels[area]
}

function formatInputSummary(input: ReaderInputDescriptor): string {
  switch (input.device) {
    case "keyboard": {
      const mods = [input.ctrl ? "Ctrl" : "", input.alt ? "Alt" : "", input.shift ? "Shift" : "", input.meta ? "Meta" : ""].filter(Boolean)
      const key = input.code.replace(/^Key/, "").replace(/^Digit/, "")
      const trigger = input.trigger === "hold" ? " 长按" : ""
      return `${[...mods, key].join("+")}${trigger}`
    }
    case "mouse":
      return `${mouseButtonLabel(input.button)} ${input.action === "click" ? "单击" : input.action === "double-click" ? "双击" : input.action === "press" ? "按下" : "长按"}`
    case "mouse-gesture":
      return `轨迹 ${input.directions.map(directionShortLabel).join("")}`
    case "wheel": {
      const mods = [input.ctrl ? "Ctrl" : "", input.alt ? "Alt" : "", input.shift ? "Shift" : "", input.meta ? "Meta" : ""].filter(Boolean)
      return `${mods.length ? `${mods.join("+")}+` : ""}滚轮${input.direction === "up" ? "上" : "下"}`
    }
    case "touch":
      return `${input.fingers}指${input.gesture === "swipe-left" ? "左滑" : input.gesture === "swipe-right" ? "右滑" : input.gesture === "swipe-up" ? "上滑" : input.gesture === "swipe-down" ? "下滑" : input.gesture === "tap" ? "点击" : "长按"}`
    case "gamepad":
      return `手柄 ${input.button}`
    case "area":
      return `区域 ${areaLabel(input.area)}`
  }
}

function formatInputChip(input: ReaderInputDescriptor): string {
  switch (input.device) {
    case "keyboard":
      return formatInputSummary(input)
    case "mouse":
      return `M${input.button}`
    case "mouse-gesture":
      return input.directions.map(directionShortLabel).join("")
    case "wheel":
      return input.direction === "up" ? "W↑" : "W↓"
    case "touch":
      return `${input.fingers}👆`
    case "gamepad":
      return `G${input.button}`
    case "area":
      return "▣"
  }
}

function actionOptionId(action: ReaderInputAction): string {
  return `input-binding-action-${action.replace(/[^a-zA-Z0-9_-]+/g, "-")}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}


export default function DockedInputBindingsSettingsCard(context: ReaderSettingsCardContext) {
  return <InputBindingsSettingsCard {...context} />
}
