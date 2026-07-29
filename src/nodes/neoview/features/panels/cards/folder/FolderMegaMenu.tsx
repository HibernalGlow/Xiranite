import {
  Bookmark,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderTree,
  Grid2X2,
  Layers3,
  ListTree,
  MoreHorizontal,
  MousePointerClick,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  RefreshCw,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  ReaderDirectoryFilterDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderEmptyAreaConfig,
  ReaderFolderConfirmationConfig,
  ReaderFolderPenetrationConfig,
  ReaderFolderTagDisplayConfig,
  ReaderFolderTitleWrapConfig,
  ReaderFolderTreeLayout,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client"
import { ReaderFilePresentationMoreMenuItems } from "../shared/ReaderFilePresentationMoreMenu"
import FolderTagDisplayMenu from "./FolderTagDisplayMenu"
import FolderTypeFilterPanel, { folderTypeFilterMeta } from "./FolderTypeFilterBar"
import { FolderStartupRestoreMenuItem } from "./FolderStartupRestoreMenuItem"
import FolderViewTitleWrapMenu from "./FolderViewTitleWrapMenu"

type FolderMegaMenuProps = {
  disabled: boolean
  busy: boolean
  currentPath?: string
  viewMode: ReaderFolderViewMode
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  canFilter: boolean
  typeFilter: ReaderDirectoryFilterDto
  filterOptions?: readonly ReaderDirectoryFilterDto[]
  showHiddenFolders: boolean
  hideMissingEfuEntries: boolean
  canHideMissingEfuEntries: boolean
  tagDisplay: ReaderFolderTagDisplayConfig
  titleWrap: ReaderFolderTitleWrapConfig
  penetration: ReaderFolderPenetrationConfig
  treeLayout: ReaderFolderTreeLayout
  canTree: boolean
  inlineTreeOpen: boolean
  confirmations: ReaderFolderConfirmationConfig
  emptyArea: ReaderFolderEmptyAreaConfig
  thumbnailRefreshPending: boolean
  canRefreshThumbnails: boolean
  canRefreshSelectedThumbnails: boolean
  thumbsEnabled: boolean
  canImportEfu: boolean
  sort?: ReaderDirectorySortDto
  sortSource?: ReaderDirectorySortSourceDto
  canSortPreference: boolean
  sortSourceLabels: Readonly<Record<ReaderDirectorySortSourceDto, string>>
  onChangeTypeFilter?(filter: ReaderDirectoryFilterDto): void
  onChangeShowHiddenFolders?(showHiddenFolders: boolean): void
  onChangeHideMissingEfuEntries?(hideMissingEfuEntries: boolean): void
  onTagDisplayChange(patch: Partial<ReaderFolderTagDisplayConfig>): void
  onTitleWrapChange(patch: Partial<ReaderFolderTitleWrapConfig>): void
  onOpenPenetrationSettings(): void
  onTreeLayoutChange(layout: ReaderFolderTreeLayout): void
  onToggleInlineTree(): void
  onCommitHoverPreviewEnabled(enabled: boolean): void
  onCommitHoverPreviewDelay(delayMs: number): void
  onContentWidthChange(value: number): void
  onCommitContentWidth(value: number): void
  onThumbnailWidthChange(value: number): void
  onCommitThumbnailWidth(value: number): void
  onBannerWidthChange(value: number): void
  onCommitBannerWidth(value: number): void
  onConfirmationChange(patch: Partial<ReaderFolderConfirmationConfig>): void
  onEmptyAreaChange(patch: Partial<ReaderFolderEmptyAreaConfig>): void
  onUpdateSortPreference(command: ReaderDirectorySortPreferenceCommandDto): void
  onRefreshVisibleThumbnails(): void
  onRefreshSelectedThumbnails(): void
  onCancelThumbnailRefresh(): void
  onImportEfu?(): void
}

const TREE_LAYOUT_OPTIONS: readonly { value: ReaderFolderTreeLayout; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "左侧", icon: PanelLeft },
  { value: "right", label: "右侧", icon: PanelRight },
  { value: "top", label: "顶部", icon: PanelTop },
  { value: "bottom", label: "底部", icon: PanelBottom },
]

const TREE_LAYOUT_LABELS: Readonly<Record<ReaderFolderTreeLayout, string>> = {
  left: "左侧",
  right: "右侧",
  top: "顶部",
  bottom: "底部",
}

export default function FolderMegaMenu({
  disabled,
  busy,
  currentPath,
  viewMode,
  contentWidthPercent,
  thumbnailWidthPercent,
  bannerWidthPercent,
  hoverPreviewEnabled,
  hoverPreviewDelayMs,
  canFilter,
  typeFilter,
  filterOptions,
  showHiddenFolders,
  hideMissingEfuEntries,
  canHideMissingEfuEntries,
  tagDisplay,
  titleWrap,
  penetration,
  treeLayout,
  canTree,
  inlineTreeOpen,
  confirmations,
  emptyArea,
  thumbnailRefreshPending,
  canRefreshThumbnails,
  canRefreshSelectedThumbnails,
  thumbsEnabled,
  canImportEfu,
  sort,
  sortSource,
  canSortPreference,
  sortSourceLabels,
  onChangeTypeFilter,
  onChangeShowHiddenFolders,
  onChangeHideMissingEfuEntries,
  onTagDisplayChange,
  onTitleWrapChange,
  onOpenPenetrationSettings,
  onTreeLayoutChange,
  onToggleInlineTree,
  onCommitHoverPreviewEnabled,
  onCommitHoverPreviewDelay,
  onContentWidthChange,
  onCommitContentWidth,
  onThumbnailWidthChange,
  onCommitThumbnailWidth,
  onBannerWidthChange,
  onCommitBannerWidth,
  onConfirmationChange,
  onEmptyAreaChange,
  onUpdateSortPreference,
  onRefreshVisibleThumbnails,
  onRefreshSelectedThumbnails,
  onCancelThumbnailRefresh,
  onImportEfu,
}: FolderMegaMenuProps) {
  const activeTypeFilter = folderTypeFilterMeta(typeFilter)
  const TypeFilterIcon = activeTypeFilter.icon
  const typeFilterActive = typeFilter !== "library" && typeFilter !== "all"

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={typeFilterActive || hoverPreviewEnabled === false || penetration.enabled ? "secondary" : "ghost"}
          aria-label="更多"
          title="更多设置"
          disabled={busy || (!currentPath && !canImportEfu)}
          data-folder-toolbar-control="more"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(72rem,calc(100vw-1rem))] max-h-[calc(100vh-1rem)] overflow-y-auto p-0"
        data-folder-toolbar-menu="more"
        data-folder-mega-menu="true"
      >
        <div className="grid grid-cols-1 gap-px bg-border/70 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <DropdownMenuGroup className="min-w-0 bg-popover p-1" data-folder-mega-menu-column="display">
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              <Settings2 className="size-3.5" />
              显示与筛选
            </DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!canFilter}>
                <TypeFilterIcon className="size-4" />
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span>显示类型</span>
                  <span className="truncate text-[10px] font-normal text-muted-foreground">{activeTypeFilter.label}</span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="p-2" data-folder-toolbar-menu="type-filter">
                <FolderTypeFilterPanel
                  value={typeFilter}
                  options={filterOptions}
                  disabled={!canFilter}
                  onChange={(next) => onChangeTypeFilter?.(next)}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuCheckboxItem
              checked={showHiddenFolders}
              disabled={!canFilter}
              onCheckedChange={(checked) => onChangeShowHiddenFolders?.(checked === true)}
            >
              <Eye className="size-4" />
              显示隐藏文件夹
            </DropdownMenuCheckboxItem>
            {canHideMissingEfuEntries ? (
              <DropdownMenuCheckboxItem
                checked={hideMissingEfuEntries}
                disabled={!canFilter}
                onCheckedChange={(checked) => onChangeHideMissingEfuEntries?.(checked === true)}
              >
                <EyeOff className="size-4" />
                隐藏不存在的文件
              </DropdownMenuCheckboxItem>
            ) : null}
            <FolderTagDisplayMenu value={tagDisplay} onChange={onTagDisplayChange} />
            <FolderViewTitleWrapMenu
              value={titleWrap}
              onChange={(nextViewMode, wrapTitle) => onTitleWrapChange({ [nextViewMode]: wrapTitle })}
            />
          </DropdownMenuGroup>

          <DropdownMenuGroup className="min-w-0 bg-popover p-1" data-folder-mega-menu-column="layout">
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              <Grid2X2 className="size-3.5" />
              布局与预览
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={inlineTreeOpen}
              disabled={!canTree}
              onCheckedChange={() => onToggleInlineTree()}
            >
              <ListTree className="size-4" />
              内联树
            </DropdownMenuCheckboxItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!canTree}>
                <FolderTree className="size-4" />
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span>文件树位置</span>
                  <span className="truncate text-[10px] font-normal text-muted-foreground">{TREE_LAYOUT_LABELS[treeLayout]}</span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-36" data-folder-toolbar-menu="tree-layout">
                <DropdownMenuRadioGroup value={treeLayout} onValueChange={(value) => onTreeLayoutChange(value as ReaderFolderTreeLayout)}>
                  {TREE_LAYOUT_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value} aria-label={`文件树位于${label}`} disabled={!canTree}>
                      <Icon className="size-4" />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Eye className="size-4" />
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span>悬停预览</span>
                  <span className="truncate text-[10px] font-normal text-muted-foreground">
                    {hoverPreviewEnabled ? `${hoverPreviewDelayMs} ms` : "已关闭"}
                  </span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52" data-folder-toolbar-menu="hover-preview">
                <DropdownMenuCheckboxItem checked={hoverPreviewEnabled} onCheckedChange={(checked) => onCommitHoverPreviewEnabled(Boolean(checked))}>
                  <Eye className="size-4" />
                  启用悬停预览
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>预览延迟</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(hoverPreviewDelayMs)} onValueChange={(value) => onCommitHoverPreviewDelay(Number(value))}>
                  <DropdownMenuRadioItem value="200" disabled={!hoverPreviewEnabled}>200 毫秒</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="500" disabled={!hoverPreviewEnabled}>500 毫秒</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="800" disabled={!hoverPreviewEnabled}>800 毫秒</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="1200" disabled={!hoverPreviewEnabled}>1200 毫秒</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <ReaderFilePresentationMoreMenuItems
              presentation={{ viewMode, contentWidthPercent, thumbnailWidthPercent, bannerWidthPercent }}
              disabled={disabled}
              resetMode="default"
              onPreview={(field, value) => {
                if (field === "contentWidthPercent") onContentWidthChange(value)
                else if (field === "thumbnailWidthPercent") onThumbnailWidthChange(value)
                else onBannerWidthChange(value)
              }}
              onCommit={(field, value) => {
                if (field === "contentWidthPercent") onCommitContentWidth(value)
                else if (field === "thumbnailWidthPercent") onCommitThumbnailWidth(value)
                else onCommitBannerWidth(value)
              }}
            />
          </DropdownMenuGroup>

          <DropdownMenuGroup className="min-w-0 bg-popover p-1" data-folder-mega-menu-column="behavior">
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              <MousePointerClick className="size-3.5" />
              浏览行为
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={onOpenPenetrationSettings}>
              <Layers3 className="size-4" />
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span>穿透设置...</span>
                <span className="truncate text-[10px] font-normal text-muted-foreground">
                  {penetration.enabled ? `${penetration.maxDepth} 层` : "已关闭"}
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trash2 className="size-4" />
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span>二次确认</span>
                  <span className="truncate text-[10px] font-normal text-muted-foreground">
                    {Object.values(confirmations).filter(Boolean).length} / 4 已开启
                  </span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56" data-folder-toolbar-menu="confirmations">
                <DropdownMenuCheckboxItem checked={confirmations.trash} onCheckedChange={(checked) => onConfirmationChange({ trash: checked === true })}>
                  <Trash2 className="size-4" />
                  已删除到回收站
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={confirmations.permanentDelete} onCheckedChange={(checked) => onConfirmationChange({ permanentDelete: checked === true })}>
                  <Trash2 className="size-4" />
                  永久删除
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={confirmations.batchTrash} onCheckedChange={(checked) => onConfirmationChange({ batchTrash: checked === true })}>
                  <Trash2 className="size-4" />
                  批量移到回收站
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={confirmations.batchPermanentDelete} onCheckedChange={(checked) => onConfirmationChange({ batchPermanentDelete: checked === true })}>
                  <Trash2 className="size-4" />
                  批量永久删除
                </DropdownMenuCheckboxItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <MousePointerClick className="size-4" />
                空白区域操作
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-folder-navigation-settings="true" className="w-52">
                <DropdownMenuLabel>单击空白</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={emptyArea.singleClickAction} onValueChange={(value) => onEmptyAreaChange({ singleClickAction: value as ReaderFolderEmptyAreaConfig["singleClickAction"] })}>
                  <DropdownMenuRadioItem value="none">无操作</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goUp">返回上级</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goBack">后退</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>双击空白</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={emptyArea.doubleClickAction} onValueChange={(value) => onEmptyAreaChange({ doubleClickAction: value as ReaderFolderEmptyAreaConfig["doubleClickAction"] })}>
                  <DropdownMenuRadioItem value="none">无操作</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goUp">返回上级</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goBack">后退</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={emptyArea.showBackButton} onCheckedChange={(showBackButton) => onEmptyAreaChange({ showBackButton: Boolean(showBackButton) })}>
                  显示底部返回按钮
                </DropdownMenuCheckboxItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <FolderStartupRestoreMenuItem disabled={busy} showSeparator={false} />
            {sort && canSortPreference && sortSource ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Bookmark className="size-3.5" />
                  排序记忆
                </DropdownMenuLabel>
                <div className="px-2 pb-1 text-[10px] text-muted-foreground">{sortSourceLabels[sortSource]}</div>
                <DropdownMenuItem onSelect={() => void onUpdateSortPreference({ action: "set-default", scope: "tab" })}>
                  <Bookmark className="size-4" />
                  设为标签默认
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void onUpdateSortPreference({ action: "set-default", scope: "global" })}>
                  <Bookmark className="size-4" />
                  设为全局默认
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void onUpdateSortPreference({ action: "clear-memory", scope: "current" })}>
                  清除此文件夹记忆
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void onUpdateSortPreference({ action: "clear-memory", scope: "all" })}>
                  清除全部排序记忆
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuGroup>

          <DropdownMenuGroup className="min-w-0 bg-popover p-1" data-folder-mega-menu-column="maintenance">
            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5" />
              数据与维护
            </DropdownMenuLabel>
            <DropdownMenuItem disabled={!canImportEfu || busy} onSelect={() => onImportEfu?.()}>
              <FileSpreadsheet className="size-4" />
              导入 EFU 文件列表
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canRefreshThumbnails || !thumbsEnabled || thumbnailRefreshPending} onSelect={() => { void onRefreshVisibleThumbnails() }}>
              <RefreshCw className="size-4" />
              重载可见缩略图
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canRefreshSelectedThumbnails || !thumbsEnabled || thumbnailRefreshPending} onSelect={() => { void onRefreshSelectedThumbnails() }}>
              <RefreshCw className="size-4" />
              重载选中缩略图
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!thumbnailRefreshPending} onSelect={onCancelThumbnailRefresh}>
              <RefreshCw className="size-4" />
              取消缩略图重载
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
