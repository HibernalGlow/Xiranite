import { useEffect, useRef, useState } from "react"
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react"
import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

export function NodeContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex h-full min-h-0 flex-col overflow-hidden p-3 text-xs font-mono", className)}>
      {children}
    </div>
  )
}

export function NodeHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-border/50 pb-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold uppercase tracking-normal text-foreground">{title}</div>
        {meta ? <div className="truncate text-[10px] text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">{actions}</div> : null}
    </div>
  )
}

export function NodeBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("min-h-0 flex-1 overflow-hidden py-2", className)}>{children}</div>
}

export function NodeFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("shrink-0 border-t border-border/50 pt-2", className)}>{children}</div>
}

export function Field({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cx("grid min-w-0 flex-1 basis-24 gap-1 text-[10px] text-muted-foreground", className)}>
      <span className="truncate">{label}</span>
      <input
        {...props}
        className="h-8 min-w-0 border-b border-border/70 bg-transparent px-1 text-xs text-foreground outline-none disabled:opacity-50"
      />
    </label>
  )
}

export function TextArea({ label, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className={cx("flex min-h-0 min-w-0 flex-1 flex-col gap-1 text-[10px] text-muted-foreground", className)}>
      <span className="shrink-0 truncate">{label}</span>
      <textarea
        {...props}
        className="min-h-0 flex-1 resize-none border border-border/50 bg-transparent p-2 text-xs text-foreground outline-none disabled:opacity-50"
      />
    </label>
  )
}

export function IconButton({ title, onClick, children, disabled }: { title: string; onClick?: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      title={title}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function ActionButton({ children, onClick, disabled, variant = "default" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "default" | "primary" | "danger" }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-8 min-w-0 items-center justify-center gap-1 rounded px-2 text-xs disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground",
        variant === "danger" && "border border-border text-red-500",
        variant === "default" && "border border-border bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
}

export function SegmentButton({ active, children, onClick, disabled }: { active?: boolean; children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-8 min-w-0 items-center justify-center gap-1 rounded border px-2 text-xs disabled:opacity-50",
        active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
}

export function StatPill({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: "neutral" | "good" | "bad" | "accent" }) {
  return (
    <div className="min-w-0 flex-1 basis-20 border-l border-border/70 px-2 py-0.5">
      <div className="truncate text-[9px] uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className={cx("truncate text-xs font-semibold", tone === "good" && "text-green-600", tone === "bad" && "text-red-500", tone === "accent" && "text-primary")}>
        {value}
      </div>
    </div>
  )
}

export function LogView({ lines, empty = "No logs", className }: { lines?: string[]; empty?: string; className?: string }) {
  return (
    <div className={cx("min-h-0 overflow-auto border-t border-border/40 pt-1 text-[11px] text-muted-foreground", className)}>
      {lines?.length ? lines.slice(-12).map((line, index) => <div key={`${index}:${line}`} className="break-all">{line}</div>) : empty}
    </div>
  )
}

export function ResultView({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("min-h-0 overflow-auto border-t border-border/40 pt-1 text-[11px]", className)}>{children}</div>
}

export type UnavailableNativeAction = <TInput = unknown, TData = unknown>(
  nodeId: string,
  input: TInput,
  onEvent?: (event: NodeRunEvent) => void,
) => Promise<NodeRunResult<TData>>

export function createUnavailableNativeAction(message: string): UnavailableNativeAction {
  return async (_nodeId, _input, _onEvent) => {
    return { success: false, message }
  }
}

export interface NodeConfigButtonProps {
  /** 是否有未保存的配置覆盖（comp.data 中存在与默认值不同的字段） */
  isDirty?: boolean
  /** 保存当前输入为默认值 */
  onSaveDefault?: () => void
  /** 从 TOML 恢复默认值到 comp.data */
  onRestoreDefault?: () => void
  /** 重置 comp.data 中的配置覆盖字段 */
  onResetOverride?: () => void
  /** 打开配置文件 */
  onOpenConfigFile?: () => void
  /** 禁用所有操作 */
  disabled?: boolean
}

export function NodeConfigButton(props: NodeConfigButtonProps) {
  const { isDirty, onSaveDefault, onRestoreDefault, onResetOverride, onOpenConfigFile, disabled } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        title="默认值"
        disabled={disabled}
        className={cx(
          "flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] disabled:opacity-50",
          isDirty
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:bg-muted",
        )}
        onClick={() => setOpen(!open)}
      >
        <span>默认值</span>
        {isDirty ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-44 border border-border bg-popover text-popover-foreground shadow-md">
          {onSaveDefault ? (
            <MenuItem label="保存当前输入为默认" onClick={() => { setOpen(false); onSaveDefault() }} />
          ) : null}
          {onRestoreDefault ? (
            <MenuItem label="从默认值恢复" onClick={() => { setOpen(false); onRestoreDefault() }} />
          ) : null}
          {onResetOverride ? (
            <MenuItem label="重置本次覆盖" onClick={() => { setOpen(false); onResetOverride() }} />
          ) : null}
          {onOpenConfigFile ? (
            <MenuItem label="打开配置文件" onClick={() => { setOpen(false); onOpenConfigFile() }} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="block w-full px-3 py-1.5 text-left text-[11px] hover:bg-muted"
      onClick={onClick}
    >
      {label}
    </button>
  )
}
