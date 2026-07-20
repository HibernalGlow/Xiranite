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
  type ReactNode,
} from "react"
import { BellRing, BookOpen, FileImage, PanelTop } from "lucide-react"
import type {
  ReaderSwitchToastPatch,
  ReaderSwitchToastSettings,
} from "@xiranite/node-neoview/switch-toast"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ReaderSwitchToastPort } from "../../switch-toast/ReaderSwitchToastStore"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardSaveFeedback, useReaderCardMutation } from "./shared/ReaderCardMutation"
import { ReaderSettingsSection, ReaderSettingsSlider, ReaderSettingsToggle } from "./shared/ReaderSettingsControls"

export type SwitchToastSettings = ReaderSwitchToastSettings
export type SwitchToastPatch = ReaderSwitchToastPatch
export type SwitchToastPort = Pick<ReaderSwitchToastPort, "subscribe" | "getSnapshot" | "preview" | "commit" | "update">

export interface SwitchToastCardProps {
  port?: SwitchToastPort
  onShowTest?(settings: SwitchToastSettings): void
  dataPanelActive?: boolean
  disabled?: boolean
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

export default function DockedSwitchToastCard({ switchToast, panelActive = true, disabled = false }: ReaderPanelContext) {
  return (
    <SwitchToastCard
      port={switchToast}
      dataPanelActive={panelActive}
      disabled={disabled}
      onShowTest={(settings) => switchToast?.show({
        title: "切换提示测试",
        description: `X ${settings.positionX}px / Y ${settings.positionY}px / 透明度 ${Math.round(settings.opacity * 100)}%`,
        durationMs: 2_600,
      })}
    />
  )
}

export function SwitchToastCard({ port, onShowTest, dataPanelActive = true, disabled = false }: SwitchToastCardProps) {
  const settings = useSyncExternalStore(
    port?.subscribe ?? subscribeNoop,
    port?.getSnapshot ?? getUndefinedSnapshot,
    port?.getSnapshot ?? getUndefinedSnapshot,
  )
  const { state: saveState, run: runMutation, markEdited, retry } = useReaderCardMutation()

  const update = useCallback((patch: SwitchToastPatch) => {
    if (port) runMutation(() => port.update(patch), () => port.update(patch))
  }, [port, runMutation])

  const commit = useCallback(() => {
    if (!port) return
    const target = port.getSnapshot()
    runMutation(() => port.commit(), () => port.update(target))
  }, [port, runMutation])
  const previewOpacity = useCallback((opacity: number) => {
    if (!port) return
    port.preview({ opacity })
    markEdited()
  }, [markEdited, port])

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
      className="@container space-y-3 text-xs text-muted-foreground"
      data-neoview-card="switch-toast"
      data-switch-toast-state="ready"
      data-panel-active={dataPanelActive ? "true" : "false"}
    >
      <CardSection
        title="提示悬浮窗"
        description="位置以窗口左上角为原点。"
        icon={<PanelTop className="size-3 text-primary" />}
        action={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            disabled={disabled}
            onClick={() => onShowTest?.(settings)}
          >
            显示测试提示
          </Button>
        )}
      >
        <div className="grid grid-cols-2 gap-2">
          <DraftNumberInput label="X 轴" value={settings.positionX} min={0} max={4096} fallback={20} disabled={disabled} onCommit={(positionX) => update({ positionX })} />
          <DraftNumberInput label="Y 轴" value={settings.positionY} min={0} max={4096} fallback={20} disabled={disabled} onCommit={(positionY) => update({ positionY })} />
        </div>

        <ReaderSettingsSlider
          label="透明度"
          min={0.1}
          max={1}
          step={0.01}
          value={settings.opacity}
          suffix="%"
          disabled={disabled}
          minLabel="10%"
          maxLabel="100%"
          valueFormatter={(opacity) => String(Math.round(opacity * 100))}
          onPreview={(opacity) => previewOpacity(clampNumber(opacity, 0.1, 1, 0.92))}
          onCommit={() => commit()}
        />

        <ReaderSettingsToggle
          label="液态玻璃效果"
          checked={settings.liquidGlass}
          disabled={disabled}
          onCheckedChange={(liquidGlass) => update({ liquidGlass })}
        />
      </CardSection>

      <CardSection title="触发条件" icon={<BellRing className="size-3 text-primary" />}>
        <ReaderSettingsToggle
          label="切换书籍时显示提示"
          checked={settings.enableBook}
          disabled={disabled}
          onCheckedChange={(enableBook) => update({ enableBook })}
        />
        <ReaderSettingsToggle
          label="切换页面时显示提示"
          checked={settings.enablePage}
          disabled={disabled}
          onCheckedChange={(enablePage) => update({ enablePage })}
        />
        <ReaderSettingsToggle
          label="按键操作时显示提示"
          description="如“键盘: 下一页”、“滚轮: 放大”等。"
          checked={settings.enableAction}
          disabled={disabled}
          onCheckedChange={(enableAction) => update({ enableAction })}
        />
        <ReaderSettingsToggle
          label="边界翻页时显示提示"
          description="在最后一页继续后翻或第一页继续前翻时显示提示。"
          checked={settings.enableBoundaryToast}
          disabled={disabled}
          onCheckedChange={(enableBoundaryToast) => update({ enableBoundaryToast })}
        />
      </CardSection>

      <TemplateSection
        title="书籍提示模板"
        icon={<BookOpen className="size-3 text-primary" />}
        titleLabel="书籍标题模板"
        titleValue={settings.bookTitleTemplate}
        titlePlaceholder="例如：已切换到 {{book.emmTranslatedTitle}}"
        descriptionLabel="书籍描述模板"
        descriptionValue={settings.bookDescriptionTemplate}
        descriptionPlaceholder="例如：路径：{{book.path}}"
        variables={BOOK_VARIABLES}
        disabled={disabled}
        onTitleCommit={(bookTitleTemplate) => update({ bookTitleTemplate })}
        onDescriptionCommit={(bookDescriptionTemplate) => update({ bookDescriptionTemplate })}
      />

      <TemplateSection
        title="页面提示模板"
        icon={<FileImage className="size-3 text-primary" />}
        titleLabel="页面标题模板"
        titleValue={settings.pageTitleTemplate}
        titlePlaceholder="例如：第 {{page.indexDisplay}} 页"
        descriptionLabel="页面描述模板"
        descriptionValue={settings.pageDescriptionTemplate}
        descriptionPlaceholder="例如：{{page.dimensionsFormatted}}"
        variables={PAGE_VARIABLES}
        disabled={disabled}
        onTitleCommit={(pageTitleTemplate) => update({ pageTitleTemplate })}
        onDescriptionCommit={(pageDescriptionTemplate) => update({ pageDescriptionTemplate })}
        footer={<>页面模板同样可以使用 <span className="font-mono">{"{{book.*}}"}</span> 变量。</>}
      />

      <ReaderCardSaveFeedback state={saveState} disabled={disabled} onRetry={retry} />
    </section>
  )
}

function CardSection({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div data-reader-card-section={title}>
      <ReaderSettingsSection title={title} description={description} icon={icon} action={action}>
        {children}
      </ReaderSettingsSection>
    </div>
  )
}

function DraftNumberInput({ label, value, min, max, fallback, disabled, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  fallback: number
  disabled: boolean
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
        disabled={disabled}
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
  icon,
  titleLabel,
  titleValue,
  titlePlaceholder,
  descriptionLabel,
  descriptionValue,
  descriptionPlaceholder,
  variables,
  disabled,
  onTitleCommit,
  onDescriptionCommit,
  footer,
}: {
  title: string
  icon: ReactNode
  titleLabel: string
  titleValue: string
  titlePlaceholder: string
  descriptionLabel: string
  descriptionValue: string
  descriptionPlaceholder: string
  variables: readonly (readonly [string, string])[]
  disabled: boolean
  onTitleCommit(value: string): void
  onDescriptionCommit(value: string): void
  footer?: ReactNode
}) {
  return (
    <CardSection title={title} icon={icon}>
      <DraftTextarea label={titleLabel} value={titleValue} placeholder={titlePlaceholder} className="min-h-10" disabled={disabled} onCommit={onTitleCommit} />
      <DraftTextarea label={descriptionLabel} value={descriptionValue} placeholder={descriptionPlaceholder} className="min-h-13" disabled={disabled} onCommit={onDescriptionCommit} />
      <VariableTable values={variables} />
      {footer ? <p className="text-[10px] text-muted-foreground">{footer}</p> : null}
    </CardSection>
  )
}

function DraftTextarea({ label, value, placeholder, className, disabled, onCommit }: {
  label: string
  value: string
  placeholder: string
  className: string
  disabled: boolean
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
        disabled={disabled}
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
