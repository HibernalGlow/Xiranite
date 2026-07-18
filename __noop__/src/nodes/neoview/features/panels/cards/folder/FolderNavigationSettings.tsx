import { MousePointerClick } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import type { ReaderFolderEmptyAreaAction, ReaderFolderEmptyAreaConfig } from "../../../../adapters/reader-http-client"

interface FolderNavigationSettingsProps {
  value: ReaderFolderEmptyAreaConfig
  disabled: boolean
  onChange(patch: Partial<ReaderFolderEmptyAreaConfig>): void
}

export default function FolderNavigationSettings({ value, disabled, onChange }: FolderNavigationSettingsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="空白区域操作" title="空白区域操作" disabled={disabled}>
          <MousePointerClick />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-folder-navigation-settings="true">
        <DropdownMenuLabel>空白区域操作</DropdownMenuLabel>
        <ActionSubmenu label="单击空白" value={value.singleClickAction} onChange={(singleClickAction) => onChange({ singleClickAction })} />
        <ActionSubmenu label="双击空白" value={value.doubleClickAction} onChange={(doubleClickAction) => onChange({ doubleClickAction })} />
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={value.showBackButton} onCheckedChange={(showBackButton) => onChange({ showBackButton })}>
          显示底部返回按钮
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ActionSubmenu({ label, value, onChange }: { label: string; value: ReaderFolderEmptyAreaAction; onChange(value: ReaderFolderEmptyAreaAction): void }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as ReaderFolderEmptyAreaAction)}>
          <DropdownMenuRadioItem value="none">无操作</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="goUp">返回上级</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="goBack">后退</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
