/**
 * @migrated-from src/lib/cards/info/SwitchToastCard.svelte
 * @source-hash sha256:5fe6e326300c28b466de5ee95b2aca8c43764e849d55074653292e2c1efe68b1
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/SwitchToastCard.tsx
 * @features switch-toast
 * @migration-status adapted
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import { RotateCcw } from "lucide-react"
import type {
  ReaderSwitchToastPatch,
  ReaderSwitchToastSettings,
} from "@xiranite/node-neoview/switch-toast"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ReaderSwitchToastPort } from "../../switch-toast/ReaderSwitchToastStore"
import type { ReaderPanelContext } from "../registry"

export type SwitchToastSettings = ReaderSwitchToastSettings
export type SwitchToastPatch = ReaderSwitchToastPatch
export type SwitchToastPort = Pick<ReaderSwitchToastPort, "subscribe" | "getSnapshot" | "preview" | "commit" | "update">

export interface SwitchToastCardProps {
  port?: SwitchToastPort
  onShowTest?(settings: SwitchToastSettings): void
  dataPanelActive?: boolean
}

const BOOK_VARIABLES = [
  ["{{book.displayName}}", "书籍显示名"],
  ["{{book.currentPageDisplay}}", "当前页码"],
  ["{{book.totalPages}}", "总页数"],
  ["{{book.path}}", "书籍路径"],
] as const

const PAGE_VARIABLES = [
  ["{{page.indexDisplay}}", "当前页码"],
  ["{{page.dimensionsFormatted}}", "分辨率"],
  ["{{page.sizeFormatted}}", "文件大小"],
  ["{{page.name}}", "页面文件名"],
] as const

export default function DockedSwitchToastCard({ switchToast, panelActive = true }: ReaderPanelContext) {
  return (
    <SwitchToastCard
      port={switchToast}
      dataPanelActive={panelActive}
      onShowTest={(settings) => switchToast?.show({
        title: "切换提示测试",
        description: `X ${settings.positionX}px / Y ${settings.positionY}px / 透明度 ${Math.round(settings.opacity * 100)}%`,
        durationMs: 2_600,
      })}
    />
  )
}

export function SwitchToastCard({ port, onShowTest, dataPanelActive = true }: SwitchToastCardProps) {
  const settings = useSyncExternalStore(
    port?.subscribe ?? subscribeNoop,
    port?.getSnapshot ?? getUndefinedSnapshot,
    port?.getSnapshot ?? getUndefinedSnapshot,
  )
  const [saveState, setSaveState] = useState<SaveState>({ phase: "idle" })
  const mountedRef = useRef(true)
  const retryRef = useRef<(() => Promise<void>)>()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const runMutation = useCallback((operation: () => Promise<void>, retry = operation) => {
    retryRef.current = retry
    setSaveState({ phase: "saving" })
    void operation().then(() => {
      if (!mountedRef.current) return
      retryRef.current = undefined
      setSaveState({ phase: "saved" })
    }).catch((cause) => {
      if (mountedRef.current) setSaveState({ phase: "error", message: errorMessage(cause) })
    })
  }, [])

  const update = useCallback((patch: SwitchToastPatch) => {
    if (port) runMutation(() => port.update(patch), () => port.update(patch))
  }, [port, runMutation])

  const commit = useCallback(() => {
    if (port) runMutation(() => port.commit(), () => port.commit())
  }, [port, runMutation])

  const retry = useCallback(() => {
    const operation = retryRef.current
    if (operation) runMutation(operation, operation)
  }, [runMutation])

  if (!settings || !port) {
    return (
      <section
        className="grid min-h-20 place-items-center text-xs text-muted-foreground"
        data-neoview-card="switch-toast"
        data-switch-toast-state="loading"
      >
        切换提示配置加载中...
      </section>
    )
  }

  return (
    <section
      className="space-y-3 text-xs text-muted-foreground"
      data-neoview-card="switch-toast"
      data-switch-toast-state="ready"
      data-panel-active={dataPanelActive ? "true" : "false"}
    >
      <CardSection
        title="提示悬浮窗"
        description="位置以窗口左上角为原点。"
        action={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => onShowTest?.(settings)}
          >
            显示测试提示
          </Button>
        )}
      >
        <div className="grid grid-cols-2 gap-2">
          <DraftNumberInput label="X 轴" value={settings.positionX} min={0} max={4096} fallback={20} onCommit={(positionX) => update({ positionX })} />
          <DraftNumberInput label="Y 轴" value={settings.positionY} min={0} max={4096} fallback={20} onCommit={(positionY) => update({ positionY })} />
        </div>

        <label className="block space-y-1.5">
          <span className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">透明度</span>
            <output className="font-mono text-[10px] text-foreground">{Math.round(settings.opacity * 100)}%</output>
          </span>
          <input
            className="h-5 w-full accent-primary"
            type="range"
            min={0.1}
            max={1}
            step={0.01}
            value={settings.opacity}
            aria-label="透明度"
            onChange={(event) => port.preview({ opacity: clampNumber(event.currentTarget.valueAsNumber, 0.1, 1, 0.92) })}
            onPointerUp={(event) => finishPointer(event, commit)}
            onPointerCancel={(event) => finishPointer(event, commit)}
            onKeyUp={(event) => finishRangeKey(event, commit)}
          />
        </label>

        <ToggleRow
          label="液态玻璃效果"
          checked={settings.liquidGlass}
          onCheckedChange={(liquidGlass) => update({ liquidGlass })}
        />
      </CardSection>

      <CardSection title="触发条件">
        <ToggleRow
          label="切换书籍时显示提示"
          checked={settings.enableBook}
          onCheckedChange={(enableBook) => update({ enableBook })}
        />
        <ToggleRow
          label="切换页面时显示提示"
          checked={settings.enablePage}
          onCheckedChange={(enablePage) => update({ enablePage })}
        />
        <ToggleRow
          label="按键操作时显示提示"
          description="如“键盘: 下一页”、“滚轮: 放大”等。"
          checked={settings.enableAction}
          onCheckedChange={(enableAction) => update({ enableAction })}
        />
        <ToggleRow
          label="边界翻页时显示提示"
          description="在最后一页继续后翻或第一页继续前翻时显示提示。"
          checked={settings.enableBoundaryToast}
          onCheckedChange={(enableBoundaryToast) => update({ enableBoundaryToast })}
        />
      </CardSection>

      <TemplateSection
        title="书籍提示模板"
        titleLabel="书籍标题模板"
        titleValue={settings.bookTitleTemplate}
        titlePlaceholder="例如：已切换到 {{book.emmTranslatedTitle}}"
        descriptionLabel="书籍描述模板"
        descriptionValue={settings.bookDescriptionTemplate}
        descriptionPlaceholder="例如：路径：{{book.path}}"
        variables={BOOK_VARIABLES}
        onTitleCommit={(bookTitleTemplate) => update({ bookTitleTemplate })}
        onDescriptionCommit={(bookDescriptionTemplate) => update({ bookDescriptionTemplate })}
      />

      <TemplateSection
        title="页面提示模板"
        titleLabel="页面标题模板"
        titleValue={settings.pageTitleTemplate}
        titlePlaceholder="例如：第 {{page.indexDisplay}} 页"
        descriptionLabel="页面描述模板"
        descriptionValue={settings.pageDescriptionTemplate}
        descriptionPlaceholder="例如：{{page.dimensionsFormatted}}"
        variables={PAGE_VARIABLES}
        onTitleCommit={(pageTitleTemplate) => update({ pageTitleTemplate })}
        onDescriptionCommit={(pageDescriptionTemplate) => update({ pageDescriptionTemplate })}
        footer={<>页面模板同样可以使用 <span className="font-mono">{"{{book.*}}"}</span> 变量。</>}
      />

      <SaveFeedback state={saveState} onRetry={retry} />
    </section>
  )
}

function CardSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-2.5 rounded-md border bg-background/50 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-foreground">{title}</div>
          {description ? <p className="mt-0.5 text-[10px] text-muted-foreground/70">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange(checked: boolean): void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {description ? <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground/70">{description}</p> : null}
      </div>
      <Switch
        size="sm"
        checked={checked}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function DraftNumberInput({ label, value, min, max, fallback, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  fallback: number
  onCommit(value: number): void
}) {
  const [draft, setDraft] = useState(String(value))
  const editingRef = useRef(false)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(String(value))
  }, [value])

  const finish = () => {
    editingRef.current = false
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(String(value))
      return
    }
    const next = parseNumberInput(draft, min, max, fallback)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <label className="space-y-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input
        className="h-7 w-full rounded-md border bg-background px-2 text-[11px] text-foreground"
        type="number"
        min={min}
        max={max}
        value={draft}
        aria-label={label}
        onFocus={() => { editingRef.current = true }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            cancelRef.current = true
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

function TemplateSection({
  title,
  titleLabel,
  titleValue,
  titlePlaceholder,
  descriptionLabel,
  descriptionValue,
  descriptionPlaceholder,
  variables,
  onTitleCommit,
  onDescriptionCommit,
  footer,
}: {
  title: string
  titleLabel: string
  titleValue: string
  titlePlaceholder: string
  descriptionLabel: string
  descriptionValue: string
  descriptionPlaceholder: string
  variables: readonly (readonly [string, string])[]
  onTitleCommit(value: string): void
  onDescriptionCommit(value: string): void
  footer?: ReactNode
}) {
  return (
    <CardSection title={title}>
      <DraftTextarea label={titleLabel} value={titleValue} placeholder={titlePlaceholder} className="min-h-10" onCommit={onTitleCommit} />
      <DraftTextarea label={descriptionLabel} value={descriptionValue} placeholder={descriptionPlaceholder} className="min-h-13" onCommit={onDescriptionCommit} />
      <VariableTable values={variables} />
      {footer ? <p className="text-[10px] text-muted-foreground">{footer}</p> : null}
    </CardSection>
  )
}

function DraftTextarea({ label, value, placeholder, className, onCommit }: {
  label: string
  value: string
  placeholder: string
  className: string
  onCommit(value: string): void
}) {
  const [draft, setDraft] = useState(value)
  const editingRef = useRef(false)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(value)
  }, [value])

  const finish = () => {
    editingRef.current = false
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(value)
      return
    }
    if (draft !== value) onCommit(draft)
  }

  return (
    <label className="grid gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <textarea
        className={`w-full rounded-md border bg-background px-2 py-1 font-mono text-[11px] text-foreground ${className}`}
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        onFocus={() => { editingRef.current = true }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            cancelRef.current = true
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

function VariableTable({ values }: { values: readonly (readonly [string, string])[] }) {
  return (
    <div className="overflow-hidden rounded-md border bg-background/60">
      <Table className="w-full table-fixed text-[11px]" data-switch-toast-variable-table="true">
        <TableHeader>
          <TableRow>
            <TableHead className="h-auto w-28 px-2 py-1">变量</TableHead>
            <TableHead className="h-auto px-2 py-1">说明</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {values.map(([variable, description]) => (
            <TableRow key={variable}>
              <TableCell className="break-all px-2 py-1 font-mono">{variable}</TableCell>
              <TableCell className="break-words px-2 py-1">{description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SaveFeedback({ state, onRetry }: { state: SaveState; onRetry(): void }) {
  if (state.phase === "saving") {
    return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">正在保存...</p>
  }
  if (state.phase === "saved") {
    return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">已保存</p>
  }
  if (state.phase === "error") {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 rounded border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
        <span>保存失败：{state.message}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw />重试
        </Button>
      </div>
    )
  }
  return null
}

function finishPointer(event: PointerEvent<HTMLInputElement>, commit: () => void): void {
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  commit()
}

function finishRangeKey(event: KeyboardEvent<HTMLInputElement>, commit: () => void): void {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit()
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function parseNumberInput(value: string, min: number, max: number, fallback: number): number {
  return clampNumber(Number(value), min, max, fallback)
}

function subscribeNoop(): () => void {
  return () => undefined
}

function getUndefinedSnapshot(): undefined {
  return undefined
}

type SaveState = { phase: "idle" | "saving" | "saved" } | { phase: "error"; message: string }

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
