/**
 * @migrated-from src/lib/cards/settings/BindingsSettingsCard.svelte
 * @migrated-from src/lib/components/dialogs/UnifiedBindingPanel.svelte
 * @source-hash sha256:669d0667f096ad915f38fe239e4e330039daf99242256c4bab6bcf5d63a658dc
 * @migration-status adapted
 */
import {
  cloneReaderInputBindings,
  READER_INPUT_ACTION_CATEGORIES,
  READER_INPUT_ACTION_CATEGORY_LABELS,
  READER_INPUT_ACTION_LABELS,
  READER_INPUT_ACTION_METADATA,
  READER_INPUT_ACTIONS,
  READER_INPUT_CONTEXT_LABELS,
  READER_INPUT_CONTEXTS,
  readerInputConflicts,
  readerInputDescriptorKey,
  type ReaderInputActionCategory,
  type ReaderInputBinding,
  type ReaderInputBindingsConfig,
  type ReaderInputDescriptor,
} from "@xiranite/node-neoview/ui-core"
import { AlertTriangle, Keyboard, Plus, Radio, RotateCcw, Save, Search, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ReaderSettingsCardContext } from "../../panels/registry"

export function InputBindingsSettingsCard({ inputBindings, onInputBindings }: ReaderSettingsCardContext) {
  if (!inputBindings || !onInputBindings) return null
  return <InputBindingsEditor value={inputBindings} onSave={onInputBindings} />
}

export function InputBindingsEditor({
  value,
  onSave,
}: {
  value: ReaderInputBindingsConfig
  onSave(patch: { bindings?: ReaderInputBinding[]; reset?: "defaults" }): Promise<ReaderInputBindingsConfig>
}) {
  const [draft, setDraft] = useState(() => cloneReaderInputBindings(value))
  const [query, setQuery] = useState("")
  const [context, setContext] = useState("all")
  const [category, setCategory] = useState<"all" | ReaderInputActionCategory>("all")
  const [recordingId, setRecordingId] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; text: string }>()
  useEffect(() => setDraft(cloneReaderInputBindings(value)), [value])
  useEffect(() => {
    if (!recordingId) return
    const capture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code === "Escape") {
        setRecordingId(undefined)
        return
      }
      if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(event.code)) return
      replace(recordingId, (binding) => ({
        ...binding,
        input: {
          device: "keyboard",
          code: event.code,
          ctrl: event.ctrlKey || undefined,
          alt: event.altKey || undefined,
          shift: event.shiftKey || undefined,
          meta: event.metaKey || undefined,
        },
      }))
      setRecordingId(undefined)
    }
    window.addEventListener("keydown", capture, true)
    return () => window.removeEventListener("keydown", capture, true)
  }, [recordingId])
  const conflicts = useMemo(() => readerInputConflicts(draft.bindings), [draft.bindings])
  const conflictIds = useMemo(() => new Set(conflicts.flatMap((current) => current.bindingIds)), [conflicts])
  const visible = draft.bindings.filter((binding) => {
    if (context !== "all" && binding.context !== context) return false
    if (category !== "all" && READER_INPUT_ACTION_METADATA[binding.action].category !== category) return false
    const search = query.trim().toLocaleLowerCase()
    return !search || `${READER_INPUT_ACTION_LABELS[binding.action]} ${READER_INPUT_ACTION_CATEGORY_LABELS[READER_INPUT_ACTION_METADATA[binding.action].category]} ${READER_INPUT_CONTEXT_LABELS[binding.context]} ${formatInput(binding.input)}`.toLocaleLowerCase().includes(search)
  })

  function replace(id: string, update: (current: ReaderInputBinding) => ReaderInputBinding) {
    setDraft((current) => ({ bindings: current.bindings.map((binding) => binding.id === id ? update(binding) : binding) }))
    setFeedback(undefined)
  }

  async function commit(patch: { bindings?: ReaderInputBinding[]; reset?: "defaults" }) {
    if (saving || conflicts.length) return
    setSaving(true)
    setFeedback(undefined)
    try {
      const updated = await onSave(patch)
      setDraft(cloneReaderInputBindings(updated))
      setFeedback({ kind: "status", text: patch.reset ? "已恢复默认绑定。" : "操作绑定已保存并立即生效。" })
    } catch (error) {
      setFeedback({ kind: "alert", text: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-4" data-neoview-settings-card="input-bindings" data-input-context="modal">
      <header className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Keyboard className="size-4 text-muted-foreground" />
        <h2 className="mr-auto text-lg font-semibold">操作绑定</h2>
        <Button type="button" size="sm" variant="outline" disabled={saving || Boolean(recordingId)} onClick={() => void commit({ reset: "defaults" })}><RotateCcw />恢复默认</Button>
        <Button type="button" size="sm" disabled={saving || conflicts.length > 0 || Boolean(recordingId)} onClick={() => void commit({ bindings: draft.bindings })}><Save />保存</Button>
      </header>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索动作、分类、上下文或输入" aria-label="搜索操作绑定" />
        </label>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={category} onChange={(event) => setCategory(event.currentTarget.value as typeof category)} aria-label="筛选动作分类">
          <option value="all">全部分类</option>
          {READER_INPUT_ACTION_CATEGORIES.map((item) => <option key={item} value={item}>{READER_INPUT_ACTION_CATEGORY_LABELS[item]}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={context} onChange={(event) => setContext(event.currentTarget.value)} aria-label="筛选上下文">
          <option value="all">全部上下文</option>
          {READER_INPUT_CONTEXTS.map((item) => <option key={item} value={item}>{READER_INPUT_CONTEXT_LABELS[item]}</option>)}
        </select>
        <Button type="button" variant="outline" disabled={Boolean(recordingId)} onClick={() => setDraft((current) => ({ bindings: [...current.bindings, newBinding(current.bindings)] }))}><Plus />添加绑定</Button>
      </div>

      {recordingId ? (
        <div role="status" className="flex items-center gap-2 rounded border border-primary/50 bg-primary/10 px-3 py-2 text-xs">
          <Radio className="size-4 animate-pulse" />请按下组合键；按 Escape 取消录制。
          <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={() => setRecordingId(undefined)}><X />取消</Button>
        </div>
      ) : null}
      {conflicts.length ? (
        <div role="alert" className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />存在 {conflicts.length} 个同上下文输入冲突；禁用、删除或修改冲突项后才能保存。
        </div>
      ) : null}

      <div className="grid gap-2" role="list" aria-label="操作绑定列表">
        {visible.map((binding) => (
          <BindingRow
            key={binding.id}
            binding={binding}
            conflicted={conflictIds.has(binding.id)}
            disabled={saving || Boolean(recordingId && recordingId !== binding.id)}
            recording={recordingId === binding.id}
            onRecord={() => setRecordingId(recordingId === binding.id ? undefined : binding.id)}
            onChange={(next) => replace(binding.id, () => next)}
            onRemove={() => setDraft((current) => ({ bindings: current.bindings.filter((item) => item.id !== binding.id) }))}
          />
        ))}
        {!visible.length ? <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的操作绑定</p> : null}
      </div>
      {feedback ? <p role={feedback.kind} className={feedback.kind === "alert" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{feedback.text}</p> : null}
    </section>
  )
}

function BindingRow({ binding, conflicted, disabled, recording, onRecord, onChange, onRemove }: {
  binding: ReaderInputBinding
  conflicted: boolean
  disabled: boolean
  recording: boolean
  onRecord(): void
  onChange(binding: ReaderInputBinding): void
  onRemove(): void
}) {
  return (
    <div role="listitem" className={`grid gap-2 rounded border px-3 py-2 lg:grid-cols-[auto_minmax(9rem,1fr)_7rem_minmax(15rem,1.5fr)_auto] lg:items-center ${conflicted ? "border-destructive/70 bg-destructive/5" : "border-border/70"}`}>
      <Switch checked={binding.enabled} disabled={disabled} onCheckedChange={(enabled) => onChange({ ...binding, enabled })} aria-label={`${READER_INPUT_ACTION_LABELS[binding.action]}启用`} />
      <select className="h-8 min-w-0 rounded border border-input bg-background px-2 text-xs" value={binding.action} disabled={disabled} onChange={(event) => onChange({ ...binding, action: event.currentTarget.value as ReaderInputBinding["action"] })} aria-label="动作">
        {READER_INPUT_ACTION_CATEGORIES.map((category) => (
          <optgroup key={category} label={READER_INPUT_ACTION_CATEGORY_LABELS[category]}>
            {READER_INPUT_ACTIONS.filter((action) => READER_INPUT_ACTION_METADATA[action].category === category).map((action) => <option key={action} value={action}>{READER_INPUT_ACTION_LABELS[action]}</option>)}
          </optgroup>
        ))}
      </select>
      <select className="h-8 rounded border border-input bg-background px-2 text-xs" value={binding.context} disabled={disabled} onChange={(event) => onChange({ ...binding, context: event.currentTarget.value as ReaderInputBinding["context"] })} aria-label="上下文">
        {READER_INPUT_CONTEXTS.map((item) => <option key={item} value={item}>{READER_INPUT_CONTEXT_LABELS[item]}</option>)}
      </select>
      <InputDescriptorEditor input={binding.input} disabled={disabled} recording={recording} onRecord={onRecord} onChange={(input) => onChange({ ...binding, input })} />
      <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={onRemove} title="删除绑定" aria-label={`删除${READER_INPUT_ACTION_LABELS[binding.action]}绑定`}><Trash2 /></Button>
    </div>
  )
}

function InputDescriptorEditor({ input, disabled, recording, onRecord, onChange }: {
  input: ReaderInputDescriptor
  disabled: boolean
  recording: boolean
  onRecord(): void
  onChange(input: ReaderInputDescriptor): void
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.device} disabled={disabled || recording} onChange={(event) => onChange(defaultInput(event.currentTarget.value as ReaderInputDescriptor["device"]))} aria-label="输入设备">
        <option value="keyboard">键盘</option><option value="mouse">鼠标</option><option value="wheel">滚轮</option><option value="touch">触控</option><option value="gamepad">手柄</option>
      </select>
      {input.device === "keyboard" ? <KeyboardInputEditor input={input} disabled={disabled} recording={recording} onRecord={onRecord} onChange={onChange} /> : null}
      {input.device === "mouse" ? <div className="grid grid-cols-2 gap-1"><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.button} disabled={disabled} onChange={(event) => onChange({ ...input, button: Number(event.currentTarget.value) })} aria-label="鼠标按钮">{Array.from({ length: 8 }, (_, button) => <option key={button} value={button}>{mouseButtonLabel(button)}</option>)}</select><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.click} disabled={disabled} onChange={(event) => onChange({ ...input, click: event.currentTarget.value as typeof input.click })} aria-label="鼠标点击方式"><option value="single">单击</option><option value="double">双击</option></select></div> : null}
      {input.device === "wheel" ? <div className="grid gap-1"><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.direction} disabled={disabled} onChange={(event) => onChange({ ...input, direction: event.currentTarget.value as typeof input.direction })} aria-label="滚轮方向"><option value="up">向上</option><option value="down">向下</option></select><ModifierEditor input={input} disabled={disabled} onChange={onChange} /></div> : null}
      {input.device === "touch" ? <div className="grid grid-cols-[1fr_5rem] gap-1"><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.gesture} disabled={disabled} onChange={(event) => onChange({ ...input, gesture: event.currentTarget.value as typeof input.gesture })} aria-label="触控手势"><option value="swipe-left">左滑</option><option value="swipe-right">右滑</option><option value="swipe-up">上滑</option><option value="swipe-down">下滑</option></select><select className="h-8 rounded border border-input bg-background px-1 text-xs" value={input.fingers} disabled={disabled} onChange={(event) => onChange({ ...input, fingers: Number(event.currentTarget.value) as 1 | 2 | 3 })} aria-label="触控手指数"><option value={1}>1 指</option><option value={2}>2 指</option><option value={3}>3 指</option></select></div> : null}
      {input.device === "gamepad" ? <Input className="h-8 text-xs" type="number" min={0} max={31} value={input.button} disabled={disabled} onChange={(event) => onChange({ ...input, button: Number(event.currentTarget.value) })} aria-label="手柄按钮编号" /> : null}
    </div>
  )
}

function KeyboardInputEditor({ input, disabled, recording, onRecord, onChange }: {
  input: Extract<ReaderInputDescriptor, { device: "keyboard" }>
  disabled: boolean
  recording: boolean
  onRecord(): void
  onChange(input: ReaderInputDescriptor): void
}) {
  return <div className="grid gap-1"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1"><Input className="h-8 text-xs" value={input.code} disabled={disabled || recording} onChange={(event) => onChange({ ...input, code: event.currentTarget.value })} aria-label="键盘代码" /><Button type="button" size="sm" variant={recording ? "default" : "outline"} disabled={disabled && !recording} onClick={onRecord} aria-label={recording ? "取消录制键盘输入" : "录制键盘输入"}><Radio />{recording ? "录制中" : "录制"}</Button></div><ModifierEditor input={input} disabled={disabled || recording} onChange={onChange} /></div>
}

function ModifierEditor<T extends Extract<ReaderInputDescriptor, { device: "keyboard" | "wheel" }>>({ input, disabled, onChange }: { input: T; disabled: boolean; onChange(input: T): void }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{(["ctrl", "alt", "shift", "meta"] as const).map((key) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(input[key])} disabled={disabled} onChange={(event) => onChange({ ...input, [key]: event.currentTarget.checked || undefined })} />{modifierLabel(key)}</label>)}</div>
}

function newBinding(bindings: readonly ReaderInputBinding[]): ReaderInputBinding {
  let sequence = bindings.length + 1
  while (bindings.some((current) => current.id === `custom-${sequence}`)) sequence += 1
  return { id: `custom-${sequence}`, action: "reader.next-page", context: "reader", enabled: false, input: { device: "keyboard", code: "KeyN" } }
}

function defaultInput(device: ReaderInputDescriptor["device"]): ReaderInputDescriptor {
  if (device === "keyboard") return { device, code: "KeyN" }
  if (device === "mouse") return { device, button: 3, click: "single" }
  if (device === "wheel") return { device, direction: "down" }
  if (device === "touch") return { device, gesture: "swipe-left", fingers: 1 }
  return { device, button: 5 }
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

function formatInput(input: ReaderInputDescriptor): string {
  return readerInputDescriptorKey(input)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
