import {
  ALargeSmall,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  CheckSquare,
  Calendar,
  Eye,
  FileType,
  FolderTree,
  GalleryHorizontalEnd,
  Grid2X2,
  HardDrive,
  Heart,
  Home,
  Layers3,
  ListTree,
  Lock,
  MoreHorizontal,
  MousePointerClick,
  RefreshCw,
  Rows3,
  Search,
  Settings2,
  Shuffle,
  Star,
  Trash2,
  Unlock,
  type LucideIcon,
} from "lucide-react"
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type {
  ReaderDirectoryFilterDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderEmptyAreaConfig,
  ReaderFolderPenetrationConfig,
  ReaderFolderTagDisplayConfig,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client"
import {
  thumbnailPixelSize,
  viewUsesBanner,
  viewUsesMosaicGrid,
  viewUsesThumbnailGrid,
  viewUsesThumbnails,
} from "./DirectoryCatalog"
import FolderTypeFilterPanel, { folderTypeFilterMeta } from "./FolderTypeFilterBar"
import FolderTagDisplayMenu from "./FolderTagDisplayMenu"
import type { FolderDeleteStrategy } from "./FolderDeleteButton"

export type FolderToolbarViewModeOption = {
  value: ReaderFolderViewMode
  label: string
  icon: LucideIcon
}

export type FolderToolbarPreviewCount = 4 | 9 | 16

const SORT_FIELD_ICONS: Readonly<Record<ReaderDirectorySortFieldDto, LucideIcon>> = {
  name: ALargeSmall,
  date: Calendar,
  size: HardDrive,
  type: FileType,
  random: Shuffle,
  rating: Star,
  path: FolderTree,
  collectTagCount: Heart,
}

export type FolderToolbarProps = {
  disabled: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  canGoUp: boolean
  homePath?: string
  currentPath?: string
  viewMode: ReaderFolderViewMode
  viewModeOptions: readonly FolderToolbarViewModeOption[]
  previewGridEnabled: boolean
  previewCount: FolderToolbarPreviewCount
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  searchOpen: boolean
  canFilter: boolean
  typeFilter?: ReaderDirectoryFilterDto
  filterOptions?: readonly ReaderDirectoryFilterDto[]
  showHiddenFolders: boolean
  tagDisplay: ReaderFolderTagDisplayConfig
  penetration: ReaderFolderPenetrationConfig
  treeOpen: boolean
  canTree: boolean
  inlineTreeOpen: boolean
  multiSelectMode: boolean
  deleteMode?: boolean
  deleteStrategy?: FolderDeleteStrategy
  confirmDelete?: boolean
  sort?: ReaderDirectorySortDto
  sortFields?: readonly ReaderDirectorySortFieldDto[]
  sortSource?: ReaderDirectorySortSourceDto
  sortTemporary?: boolean
  canSort: boolean
  canSortPreference: boolean
  emptyArea: ReaderFolderEmptyAreaConfig
  thumbnailRefreshPending: boolean
  canRefreshThumbnails: boolean
  canRefreshSelectedThumbnails: boolean
  sortLabels: Readonly<Record<ReaderDirectorySortFieldDto, string>>
  sortSourceLabels: Readonly<Record<ReaderDirectorySortSourceDto, string>>
  onNavigateBack(): void
  onNavigateForward(): void
  onNavigateUp(): void
  onGoHome(): void
  onSetHome(): void
  onRefresh(): void
  onSwitchView(mode: ReaderFolderViewMode): void
  onTogglePreviewGrid(enabled: boolean): void
  onSwitchPreviewCount(count: FolderToolbarPreviewCount): void
  onCommitHoverPreviewEnabled(enabled: boolean): void
  onCommitHoverPreviewDelay(delayMs: number): void
  onContentWidthChange(value: number): void
  onCommitContentWidth(value: number): void
  onThumbnailWidthChange(value: number): void
  onCommitThumbnailWidth(value: number): void
  onBannerWidthChange(value: number): void
  onCommitBannerWidth(value: number): void
  onToggleSearch(): void
  onChangeTypeFilter?(filter: ReaderDirectoryFilterDto): void
  onChangeShowHiddenFolders?(showHiddenFolders: boolean): void
  onTagDisplayChange(patch: Partial<ReaderFolderTagDisplayConfig>): void
  onTogglePenetration(enabled: boolean): void
  onUpdatePenetration(patch: Partial<ReaderFolderPenetrationConfig>): void
  onToggleTree(): void
  onToggleInlineTree(): void
  onToggleMultiSelect(): void
  onToggleDeleteMode?(): void
  onToggleDeleteStrategy?(): void
  onConfirmDeleteChange?(confirm: boolean): void
  onUpdateSort(sort: ReaderDirectorySortDto): void
  onUpdateSortPreference(command: ReaderDirectorySortPreferenceCommandDto): void
  onEmptyAreaChange(patch: Partial<ReaderFolderEmptyAreaConfig>): void
  onRefreshVisibleThumbnails(): void
  onRefreshSelectedThumbnails(): void
  onCancelThumbnailRefresh(): void
}

/**
 * Compact single-row folder chrome.
 * Primary cluster stays left; overflow menu is hierarchical and icon-led.
 * Type filtering is a structured panel under 更多 — not the old chip strip.
 */
export default function FolderToolbar(props: FolderToolbarProps) {
  const [penetrationSettingsOpen, setPenetrationSettingsOpen] = useState(false)
  const {
    disabled,
    loading,
    canGoBack,
    canGoForward,
    canGoUp,
    homePath,
    currentPath,
    viewMode,
    viewModeOptions,
    previewGridEnabled,
    previewCount,
    hoverPreviewEnabled,
    hoverPreviewDelayMs,
    contentWidthPercent,
    thumbnailWidthPercent,
    bannerWidthPercent,
    searchOpen,
    canFilter,
    typeFilter = "library",
    filterOptions,
    showHiddenFolders,
    tagDisplay,
    penetration,
    treeOpen,
    canTree,
    inlineTreeOpen,
    multiSelectMode,
    deleteMode = false,
    deleteStrategy = "trash",
    confirmDelete = true,
    sort,
    sortFields,
    sortSource,
    sortTemporary,
    canSort,
    canSortPreference,
    emptyArea,
    thumbnailRefreshPending,
    canRefreshThumbnails,
    canRefreshSelectedThumbnails,
    sortLabels,
    sortSourceLabels,
    onNavigateBack,
    onNavigateForward,
    onNavigateUp,
    onGoHome,
    onSetHome,
    onRefresh,
    onSwitchView,
    onTogglePreviewGrid,
    onSwitchPreviewCount,
    onCommitHoverPreviewEnabled,
    onCommitHoverPreviewDelay,
    onContentWidthChange,
    onCommitContentWidth,
    onThumbnailWidthChange,
    onCommitThumbnailWidth,
    onBannerWidthChange,
    onCommitBannerWidth,
    onToggleSearch,
    onChangeTypeFilter,
    onChangeShowHiddenFolders,
    onTagDisplayChange,
    onTogglePenetration,
    onUpdatePenetration,
    onToggleTree,
    onToggleInlineTree,
    onToggleMultiSelect,
    onToggleDeleteMode = () => undefined,
    onToggleDeleteStrategy = () => undefined,
    onConfirmDeleteChange = () => undefined,
    onUpdateSort,
    onUpdateSortPreference,
    onEmptyAreaChange,
    onRefreshVisibleThumbnails,
    onRefreshSelectedThumbnails,
    onCancelThumbnailRefresh,
  } = props

  const busy = disabled || loading
  const currentView = viewModeOptions.find((option) => option.value === viewMode) ?? viewModeOptions[0]!
  const CurrentViewIcon = currentView.icon
  const sizeEnabled = viewMode === "cover-list" || viewUsesThumbnailGrid(viewMode) || viewUsesMosaicGrid(viewMode) || viewUsesBanner(viewMode)
  const thumbsEnabled = viewUsesThumbnails(viewMode)
  const sortFieldLabel = sort ? sortLabels[sort.field] : "排序"
  const sortOrderLabel = sort?.order === "asc" ? "升序" : "降序"
  const SortFieldIcon = sort ? SORT_FIELD_ICONS[sort.field] : ALargeSmall
  const activeTypeFilter = folderTypeFilterMeta(typeFilter)
  const TypeFilterIcon = activeTypeFilter.icon
  const typeFilterActive = typeFilter !== "library" && typeFilter !== "all"

  return (
    <div
      className="flex min-w-0 items-center gap-0.5"
      data-folder-toolbar-row="operations"
      data-folder-toolbar-layout="single-row"
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        <div className="flex shrink-0 items-center gap-0.5" data-folder-toolbar-group="nav">
          <ToolbarIconButton label="后退" disabled={!canGoBack || busy} onClick={onNavigateBack}><ArrowLeft /></ToolbarIconButton>
          <ToolbarIconButton label="前进" disabled={!canGoForward || busy} onClick={onNavigateForward}><ArrowRight /></ToolbarIconButton>
          <ToolbarIconButton label="上级" disabled={!canGoUp || busy} onClick={onNavigateUp}><ArrowUp /></ToolbarIconButton>
        </div>

        <ToolbarDivider />

        <div className="flex shrink-0 items-center gap-0.5" data-folder-toolbar-group="home">
          <ToolbarIconButton
            label="主页（单击返回主页，右键设置当前路径为主页）"
            disabled={!currentPath || busy}
            clickDisabled={!homePath}
            active={Boolean(currentPath && homePath && currentPath === homePath)}
            onClick={onGoHome}
            onContextMenu={(event) => {
              event.preventDefault()
              if (currentPath && !busy && currentPath !== homePath) onSetHome()
            }}
          >
            <Home />
          </ToolbarIconButton>
          <ToolbarIconButton label="刷新" disabled={!currentPath || busy} onClick={onRefresh}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </ToolbarIconButton>
        </div>

        <ToolbarDivider />

        <div className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden" data-folder-toolbar-group="primary">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="视图"
                title={`视图：${currentView.label}`}
                disabled={!currentPath || busy}
                data-folder-toolbar-control="view"
              >
                <CurrentViewIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52" data-folder-toolbar-menu="view">
              <DropdownMenuLabel>视图模式</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={viewMode} onValueChange={(value) => onSwitchView(value as ReaderFolderViewMode)}>
                {viewModeOptions.map((option) => {
                  const Icon = option.icon
                  return (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <Icon className="size-4" />
                      {option.label}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
              {thumbsEnabled ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={previewGridEnabled}
                    onCheckedChange={(checked) => onTogglePreviewGrid(checked === true)}
                  >
                    <Grid2X2 className="size-4" />
                    多图预览
                  </DropdownMenuCheckboxItem>
                  {previewGridEnabled ? (
                    <>
                      <DropdownMenuLabel>多图数量</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={String(previewCount)}
                        onValueChange={(value) => onSwitchPreviewCount(Number(value) as FolderToolbarPreviewCount)}
                      >
                        <DropdownMenuRadioItem value="4">4 图</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="9">9 图</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="16">16 图</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </>
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {sort && sortFields ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={sortTemporary ? "default" : "ghost"}
                  aria-label="排序"
                  title={`排序：${sortFieldLabel} · ${sortOrderLabel}`}
                  disabled={!currentPath || busy || !canSort}
                  data-folder-toolbar-control="sort"
                  aria-pressed={sortTemporary || undefined}
                >
                  <span className="relative grid size-4 place-items-center" aria-hidden="true">
                    <SortFieldIcon className="size-4" data-folder-sort-field-icon={sort.field} />
                    {sort.order === "asc"
                      ? <ArrowUp className="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-background p-px" data-folder-sort-order-icon="asc" />
                      : <ArrowDown className="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-background p-px" data-folder-sort-order-icon="desc" />}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52" data-folder-toolbar-menu="sort">
                <DropdownMenuLabel>排序字段</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort.field}
                  onValueChange={(field) => onUpdateSort({ ...sort, field: field as ReaderDirectorySortFieldDto })}
                >
                  {sortFields.map((field) => (
                    <DropdownMenuRadioItem key={field} value={field}>{sortLabels[field]}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onUpdateSort({ ...sort, order: sort.order === "asc" ? "desc" : "asc" })}
                >
                  {sort.order === "asc" ? <ArrowDown /> : <ArrowUp />}
                  {sort.order === "asc" ? "切换为降序" : "切换为升序"}
                </DropdownMenuItem>
                {canSortPreference ? (
                  <DropdownMenuItem
                    onSelect={() => onUpdateSortPreference({ action: "temporary", enabled: !sortTemporary })}
                  >
                    {sortTemporary ? <Unlock /> : <Lock />}
                    {sortTemporary ? "取消临时排序" : "锁定当前目录排序"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <ToolbarIconButton
            label="搜索文件"
            disabled={!currentPath || busy}
            active={searchOpen}
            onClick={onToggleSearch}
          >
            <Search />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="文件树"
            disabled={!currentPath || busy || !canTree}
            active={treeOpen}
            onClick={onToggleTree}
          >
            <ListTree />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={penetration.enabled ? "关闭穿透模式" : "开启穿透模式"}
            disabled={!currentPath || busy}
            active={penetration.enabled}
            onClick={() => onTogglePenetration(!penetration.enabled)}
          >
            <Layers3 />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={multiSelectMode ? "退出多选" : "多选模式"}
            disabled={!currentPath || busy}
            active={multiSelectMode}
            onClick={onToggleMultiSelect}
          >
            <CheckSquare />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={`删除模式（${deleteStrategy === "trash" ? "回收站" : "永久删除"}，右键切换策略）`}
            disabled={!currentPath || busy}
            active={deleteMode}
            onClick={onToggleDeleteMode}
            onContextMenu={(event) => {
              event.preventDefault()
              if (!busy) onToggleDeleteStrategy()
            }}
          >
            <Trash2 />
          </ToolbarIconButton>
          {thumbnailRefreshPending ? (
            <ToolbarIconButton
              label="取消缩略图重载"
              disabled={busy}
              active
              onClick={onCancelThumbnailRefresh}
            >
              <RefreshCw className="animate-spin" />
            </ToolbarIconButton>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pl-0.5" data-folder-toolbar-group="more">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={typeFilterActive || hoverPreviewEnabled === false || penetration.enabled ? "secondary" : "ghost"}
              aria-label="更多"
              title="更多设置"
              disabled={!currentPath || busy}
              data-folder-toolbar-control="more"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72" data-folder-toolbar-menu="more">
            <DropdownMenuLabel className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
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

            <FolderTagDisplayMenu value={tagDisplay} onChange={onTagDisplayChange} />

            <DropdownMenuCheckboxItem
              checked={confirmDelete}
              onCheckedChange={(checked) => onConfirmDeleteChange(checked === true)}
            >
              <Trash2 className="size-4" />
              删除前确认
            </DropdownMenuCheckboxItem>

            <DropdownMenuItem onSelect={() => setPenetrationSettingsOpen(true)}>
              <Layers3 className="size-4" />
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span>穿透设置...</span>
                <span className="truncate text-[10px] font-normal text-muted-foreground">
                  {penetration.enabled ? `${penetration.maxDepth} 层` : "已关闭"}
                </span>
              </span>
            </DropdownMenuItem>

            <DropdownMenuCheckboxItem
              checked={inlineTreeOpen}
              disabled={!canTree}
              onCheckedChange={() => onToggleInlineTree()}
            >
              <ListTree className="size-4" />
              内联树
            </DropdownMenuCheckboxItem>

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
                <DropdownMenuCheckboxItem
                  checked={hoverPreviewEnabled}
                  onCheckedChange={(checked) => onCommitHoverPreviewEnabled(Boolean(checked))}
                >
                  <Eye className="size-4" />
                  启用悬停预览
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>预览延迟</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={String(hoverPreviewDelayMs)}
                  onValueChange={(value) => onCommitHoverPreviewDelay(Number(value))}
                >
                  <DropdownMenuRadioItem value="200" disabled={!hoverPreviewEnabled}>200 毫秒</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="500" disabled={!hoverPreviewEnabled}>500 毫秒</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="800" disabled={!hoverPreviewEnabled}>800 毫秒</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="1200" disabled={!hoverPreviewEnabled}>1200 毫秒</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {sizeEnabled ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {viewUsesBanner(viewMode) ? <GalleryHorizontalEnd className="size-4" /> : <Grid2X2 className="size-4" />}
                  项目尺寸
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64 p-3" data-folder-toolbar-menu="size">
                  {viewMode === "cover-list" ? (
                    <div className="grid grid-cols-[1rem_minmax(5rem,1fr)_3rem] items-center gap-2" data-folder-size-control="content">
                      <Rows3 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <Slider
                        aria-label="内容预览宽度"
                        min={20}
                        max={70}
                        step={1}
                        value={[contentWidthPercent]}
                        disabled={disabled}
                        onValueChange={(value) => onContentWidthChange(value[0] ?? 35)}
                        onValueCommit={(value) => onCommitContentWidth(value[0] ?? 35)}
                      />
                      <span className="text-right text-[10px] tabular-nums text-muted-foreground">
                        {contentWidthPercent}%
                      </span>
                    </div>
                  ) : null}
                  {viewUsesThumbnailGrid(viewMode) || viewUsesMosaicGrid(viewMode) ? (
                    <div className="grid grid-cols-[1rem_minmax(5rem,1fr)_3rem] items-center gap-2" data-folder-size-control="thumbnail">
                      <Grid2X2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <Slider
                        aria-label="缩略图宽度"
                        min={10}
                        max={90}
                        step={1}
                        value={[thumbnailWidthPercent]}
                        disabled={disabled}
                        onValueChange={(value) => onThumbnailWidthChange(value[0] ?? 20)}
                        onValueCommit={(value) => onCommitThumbnailWidth(value[0] ?? 20)}
                      />
                      <span className="text-right text-[10px] tabular-nums text-muted-foreground">
                        {thumbnailPixelSize(thumbnailWidthPercent)}px
                      </span>
                    </div>
                  ) : null}
                  {viewUsesBanner(viewMode) ? (
                    <div className="grid grid-cols-[1rem_minmax(5rem,1fr)_3rem] items-center gap-2" data-folder-size-control="banner">
                      <GalleryHorizontalEnd className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <Slider
                        aria-label="横幅宽度"
                        min={20}
                        max={100}
                        step={10}
                        value={[bannerWidthPercent]}
                        disabled={disabled}
                        onValueChange={(value) => onBannerWidthChange(value[0] ?? 50)}
                        onValueCommit={(value) => onCommitBannerWidth(value[0] ?? 50)}
                      />
                      <span className="text-right text-[10px] tabular-nums text-muted-foreground">
                        {Math.max(1, Math.floor(100 / bannerWidthPercent))} 列
                      </span>
                    </div>
                  ) : null}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <RefreshCw className="size-3.5" />
              缩略图
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={!canRefreshThumbnails || !thumbsEnabled || thumbnailRefreshPending}
              onSelect={() => { void onRefreshVisibleThumbnails() }}
            >
              <RefreshCw className="size-4" />
              重载可见缩略图
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canRefreshSelectedThumbnails || !thumbsEnabled || thumbnailRefreshPending}
              onSelect={() => { void onRefreshSelectedThumbnails() }}
            >
              <RefreshCw className="size-4" />
              重载选中缩略图
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!thumbnailRefreshPending}
              onSelect={onCancelThumbnailRefresh}
            >
              <RefreshCw className="size-4" />
              取消缩略图重载
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <MousePointerClick className="size-3.5" />
              导航
            </DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <MousePointerClick className="size-4" />
                空白区域操作
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-folder-navigation-settings="true" className="w-52">
                <DropdownMenuLabel>单击空白</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={emptyArea.singleClickAction}
                  onValueChange={(value) => onEmptyAreaChange({ singleClickAction: value as ReaderFolderEmptyAreaConfig["singleClickAction"] })}
                >
                  <DropdownMenuRadioItem value="none">无操作</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goUp">返回上级</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goBack">后退</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>双击空白</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={emptyArea.doubleClickAction}
                  onValueChange={(value) => onEmptyAreaChange({ doubleClickAction: value as ReaderFolderEmptyAreaConfig["doubleClickAction"] })}
                >
                  <DropdownMenuRadioItem value="none">无操作</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goUp">返回上级</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="goBack">后退</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={emptyArea.showBackButton}
                  onCheckedChange={(showBackButton) => onEmptyAreaChange({ showBackButton: Boolean(showBackButton) })}
                >
                  显示底部返回按钮
                </DropdownMenuCheckboxItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {sort && canSortPreference && sortSource ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={penetrationSettingsOpen} onOpenChange={setPenetrationSettingsOpen}>
        <DialogContent className="max-w-sm" data-folder-penetration-settings="true">
          <DialogHeader>
            <DialogTitle>穿透设置</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field orientation="horizontal">
              <FieldLabel htmlFor="folder-penetration-enabled">启用穿透模式</FieldLabel>
              <Switch
                id="folder-penetration-enabled"
                aria-label="启用穿透模式"
                checked={penetration.enabled}
                disabled={busy}
                onCheckedChange={onTogglePenetration}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="folder-penetration-depth">最大穿透层数</FieldLabel>
              <Select
                value={String(penetration.maxDepth)}
                disabled={busy}
                onValueChange={(value) => onUpdatePenetration({ maxDepth: Number(value) })}
              >
                <SelectTrigger id="folder-penetration-depth" className="w-full" aria-label="最大穿透层数">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PENETRATION_DEPTH_OPTIONS.map((depth) => (
                      <SelectItem key={depth} value={String(depth)}>{depth === 32 ? "32 层（安全上限）" : `${depth} 层`}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <FieldSet className="gap-2">
              <FieldLegend variant="label">可直接作为书籍打开</FieldLegend>
              {PENETRATION_TARGET_OPTIONS.map(({ value, label }) => {
                const checked = penetration.terminalTargets.includes(value)
                return (
                  <Field key={value} orientation="horizontal" className="h-9 rounded-md border px-3">
                    <FieldLabel htmlFor={`folder-penetration-target-${value}`}>{label}</FieldLabel>
                    <Switch
                      id={`folder-penetration-target-${value}`}
                      aria-label={label}
                      checked={checked}
                      disabled={busy || (checked && penetration.terminalTargets.length === 1)}
                      onCheckedChange={(nextChecked) => {
                        const next = nextChecked
                          ? [...penetration.terminalTargets, value]
                          : penetration.terminalTargets.filter((target) => target !== value)
                        if (next.length) onUpdatePenetration({ terminalTargets: next })
                      }}
                    />
                  </Field>
                )
              })}
            </FieldSet>
          </FieldGroup>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const PENETRATION_DEPTH_OPTIONS = [1, 2, 3, 5, 10, 32] as const

const PENETRATION_TARGET_OPTIONS: readonly { value: ReaderFolderPenetrationConfig["terminalTargets"][number]; label: string }[] = [
  { value: "archive", label: "压缩包" },
  { value: "document", label: "文档" },
  { value: "media-directory", label: "图片与媒体目录" },
  { value: "file", label: "其他可读文件" },
]

function ToolbarDivider() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />
}

function ToolbarIconButton({
  label,
  disabled = false,
  clickDisabled = false,
  active = false,
  onClick,
  onContextMenu,
  children,
}: {
  label: string
  disabled?: boolean
  clickDisabled?: boolean
  active?: boolean
  onClick(): void
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={active ? "default" : "ghost"}
      aria-label={label}
      title={label}
      aria-disabled={disabled || clickDisabled}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={() => {
        if (!clickDisabled) onClick()
      }}
      onContextMenu={onContextMenu}
    >
      {children}
    </Button>
  )
}
