import { Tag } from "lucide-react"

import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import type { ReaderFolderTagDisplayConfig } from "../../../../adapters/reader-http-client"

export default function FolderTagDisplayMenu({ value, onChange }: { value: ReaderFolderTagDisplayConfig; onChange(patch: Partial<ReaderFolderTagDisplayConfig>): void }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Tag className="size-4" />
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span>文件信息显示</span>
          <span className="truncate text-[10px] font-normal text-muted-foreground">评分、标签与收藏数</span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56" data-folder-toolbar-menu="tag-display">
        <DropdownMenuLabel>标签显示</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.tagMode} onValueChange={(tagMode) => onChange({ tagMode: tagMode as ReaderFolderTagDisplayConfig["tagMode"] })}>
          <DropdownMenuRadioItem value="all">全部标签</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="collect">收藏标签</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="none">隐藏标签</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={value.showRating} onCheckedChange={(checked) => onChange({ showRating: checked === true })}>显示评分</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={value.showCollectTagCount} onCheckedChange={(checked) => onChange({ showCollectTagCount: checked === true })}>显示收藏标签数</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={value.showTags} onCheckedChange={(checked) => onChange({ showTags: checked === true })}>显示 EMM/manual/AI 标签</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={value.showTooltips} onCheckedChange={(checked) => onChange({ showTooltips: checked === true })}>显示完整值提示</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>最多显示标签</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(value.maxTags)} onValueChange={(next) => onChange({ maxTags: Number(next) })}>
          {[1, 3, 5, 8, 12].map((count) => <DropdownMenuRadioItem key={count} value={String(count)}>{count} 个</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
