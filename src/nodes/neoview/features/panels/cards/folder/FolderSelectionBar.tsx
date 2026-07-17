import { CheckSquare, Link, MousePointer2, Square, SquareX, X } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export default function FolderSelectionBar({ selectedCount, total, chainSelectMode, clickBehavior, onSelectAll, onInvert, onToggleChain, onToggleClickBehavior, onClear, onClose }: {
  selectedCount: number
  total: number
  chainSelectMode: boolean
  clickBehavior: "open" | "select"
  onSelectAll(): void
  onInvert(): void
  onToggleChain(): void
  onToggleClickBehavior(): void
  onClear(): void
  onClose(): void
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 border-y px-1 py-1" data-neoview-folder-selection-bar="true">
      <span className="min-w-[4.5rem] text-xs font-medium tabular-nums"><span className="text-primary">{selectedCount}</span> / {total}</span>
      <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
        <Action label="选择全部项目" disabled={selectedCount === total} onClick={onSelectAll}><CheckSquare /></Action>
        <Action label="反转选择状态" disabled={total === 0} onClick={onInvert}><Square /></Action>
        <Action label="链接选中模式" pressed={chainSelectMode} onClick={onToggleChain}><Link /></Action>
        <Button
          type="button"
          size="sm"
          variant={clickBehavior === "select" ? "default" : "ghost"}
          className="h-7 gap-1 px-2 text-xs"
          aria-label={`点击行为：${clickBehavior === "select" ? "点选" : "点开"}`}
          aria-pressed={clickBehavior === "select"}
          title={`点击卡片会${clickBehavior === "select" ? "选中或取消选中" : "打开项目"}`}
          onClick={onToggleClickBehavior}
        >
          <MousePointer2 />{clickBehavior === "select" ? "点选" : "点开"}
        </Button>
        <Action label="取消全部选择" disabled={selectedCount === 0} onClick={onClear}><SquareX /></Action>
        <Action label="关闭多选模式" onClick={onClose}><X /></Action>
      </div>
    </div>
  )
}

function Action({ label, disabled = false, pressed, onClick, children }: { label: string; disabled?: boolean; pressed?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <Button type="button" size="icon-sm" variant={pressed ? "default" : "ghost"} aria-label={label} aria-pressed={pressed} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}
