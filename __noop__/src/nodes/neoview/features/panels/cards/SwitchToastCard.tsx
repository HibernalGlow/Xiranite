/**
 * @migrated-from src/lib/cards/info/SwitchToastCard.svelte
 * @source-hash sha256:5fe6e326300c28b466de5ee95b2aca8c43764e849d55074653292e2c1efe68b1
 * @features switch-toast
 * @migration-status adapted
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import type {
  ReaderSwitchToastPatch,
  ReaderSwitchToastSettings,
} from "@xiranite/node-neoview/switch-toast"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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

export default function DockedSwitchToastCard({ switchToast }: ReaderPanelContext) {
  return (
    <SwitchToastCard
      port={switchToast}
      onShowTest={(settings) => switchToast?.show({
        title: "切换提示测试",
        description: `X ${settings.positionX}px / Y ${settings.positionY}px / 透明度 ${Math.round(settings.opacity * 100)}%`,
        durationMs: 2_600,
      })}
    />
  )
}

export function SwitchToastCard({ port, onShowTest }: SwitchToastCardProps) {
  const settings = useSyncExternalStore(
    port?.subscribe ?? subscribeNoop,
    port?.getSnapshot ?? getUndefinedSnapshot,
    port?.getSnapshot ?? getUndefinedSnapshot,
  )

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
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold text-foreground">提示悬浮窗</div>
            <div className="text-[10px] text-muted-foreground/60">位置以窗口左上角为原点</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => onShowTest?.(settings)}
          >
            显示测试提示
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <DraftNumberInput label="X 轴" value={settings.positionX} min={0} max={4096} fallback={20} onCommit={(positionX) => void port.update({ positionX })} />
          <DraftNumberInput label="Y 轴" value={settings.positionY} min={0} max={4096} fallback={20} onCommit={(positionY) => void port.update({ positionY })} />
        </div>

        <label className="block space-y-1">
          <span className="flex items-center justify-between">
            <span className="text-[10px]">透明度</span>
            <output className="font-mono text-[10px]">{Math.round(settings.opacity * 100)}%</output>
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
            onPointerUp={(event) => finishPointer(event, () => port.commit())}
            onPointerCancel={(event) => finishPointer(event, () => port.commit())}
            onKeyUp={(event) => finishRangeKey(event, () => port.commit())}
          />
        </label>

        <SwitchRow label="液态玻璃效果" checked={settings.liquidGlass} onCheckedChange={(liquidGlass) => void port.update({ liquidGlass })} />
      </div>

      <Separator className="my-1" />
      <SwitchRow label="切换书籍时显示提示" checked={settings.enableBook} onCheckedChange={(enableBook) => void port.update({ enableBook })} />
      <Separator className="my-1" />
      <SwitchRow label="切换页面时显示提示" checked={settings.enablePage} onCheckedChange={(enablePage) => void port.update({ enablePage })} />
      <Separator className="my-1" />
      <div className="space-y-1">
        <SwitchRow label="按键操作时显示提示" checked={settings.enableAction} onCheckedChange={(enableAction) => void port.update({ enableAction })} />
        <p className="text-[10px] text-muted-foreground/60">如“键盘: 下一页”、“滚轮: 放大”等</p>
      </div>
      <Separator className="my-1" />
      <div className="space-y-1">
        <SwitchRow label="边界翻页时显示提示" checked={settings.enableBoundaryToast} onCheckedChange={(enableBoundaryToast) => void port.update({ enableBoundaryToast })} />
        <p className="text-[10px] text-muted-foreground/60">在最后一页继续后翻或第一页继续前翻时显示提示</p>
      </div>
      <Separator className="my-1" />

      <TemplateSection
        title="书籍提示模板"
        titleLabel="书籍标题模板"
        titleValue={settings.bookTitleTemplate}
        titlePlaceholder="例如：已切换到 {{book.emmTranslatedTitle}}"
        descriptionLabel="书籍描述模板"
        descriptionValue={settings.bookDescriptionTemplate}
        descriptionPlaceholder="例如：路径：{{book.path}}"
        variables={BOOK_VARIABLES}
        onTitleCommit={(bookTitleTemplate) => void port.update({ bookTitleTemplate })}
        onDescriptionCommit={(bookDescriptionTemplate) => void port.update({ bookDescriptionTemplate })}
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
        onTitleCommit={(pageTitleTemplate) => void port.update({ pageTitleTemplate })}
        onDescriptionCommit={(pageDescriptionTemplate) => void port.update({ pageDescriptionTemplate })}
        footer={<>页面模板同样可以使用 <span className="font-mono">{"{{book.*}}"}</span> 变量。</>}
      />
    </section>
  )
}

function SwitchRow({ label, checked, onCheckedChange }: {
  label: string
  checked: boolean
  onCheckedChange(checked: boolean): void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <Switch className="origin-right scale-75" size="sm" checked={checked} aria-label={label} onCheckedChange={onCheckedChange} />
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
      <span className="text-[10px]">{label}</span>
      <input
        className="h-7 w-full rounded-md border bg-background px-2 text-[11px]"
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
    <div className="space-y-2">
      <div className="text-[11px] font-semibold text-foreground">{title}</div>
      <DraftTextarea label={titleLabel} value={titleValue} placeholder={titlePlaceholder} className="min-h-10" onCommit={onTitleCommit} />
      <DraftTextarea label={descriptionLabel} value={descriptionValue} placeholder={descriptionPlaceholder} className="min-h-13" onCommit={onDescriptionCommit} />
      <VariableTable values={variables} />
      {footer ? <p className="mt-1 text-[10px] text-muted-foreground">{footer}</p> : null}
    </div>
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
    <textarea
      className={`w-full rounded-md border bg-background px-2 py-1 font-mono text-[11px] ${className}`}
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
  )
}

function VariableTable({ values }: { values: readonly (readonly [string, string])[] }) {
  return (
    <div className="mt-1 overflow-hidden rounded-md border bg-background/60">
      <Table className="w-full text-[11px]">
        <TableHeader><TableRow><TableHead className="h-auto w-28 px-2 py-1">变量</TableHead><TableHead className="h-auto px-2 py-1">说明</TableHead></TableRow></TableHeader>
        <TableBody>
          {values.map(([variable, description]) => (
            <TableRow key={variable}><TableCell className="px-2 py-1 font-mono">{variable}</TableCell><TableCell className="px-2 py-1">{description}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function finishPointer(event: PointerEvent<HTMLInputElement>, commit: () => Promise<void>): void {
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  void commit()
}

function finishRangeKey(event: KeyboardEvent<HTMLInputElement>, commit: () => Promise<void>): void {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) void commit()
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
