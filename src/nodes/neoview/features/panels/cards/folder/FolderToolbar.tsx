import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  CheckSquare,
  ClipboardPaste,
  Eye,
  GalleryHorizontalEnd,
  Grid2X2,
  Home,
  ListTree,
  Lock,
  MoreHorizontal,
  MousePointerClick,
  RefreshCw,
  Search,
  Settings2,
  Unlock,
  type LucideIcon,
} from "lucide-react"
import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
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
import type {
  ReaderDirectoryFilterDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderEmptyAreaConfig,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client"
import {
  thumbnailPixelSize,
  viewUsesBanner,
  viewUsesThumbnailGrid,
  viewUsesThumbnails,
} from "./DirectoryCatalog"
import FolderTypeFilterPanel, { folderTypeFilterMeta } from "./FolderTypeFilterBar"

export type FolderToolbarViewModeOption = {
  value: ReaderFolderViewMode
  label: string
  icon: LucideIcon
}

export type FolderToolbarPreviewCount = 4 | 9 | 16

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
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  searchOpen: boolean
  canFilter: boolean
  typeFilter?: ReaderDirectoryFilterDto
  filterOptions?: readonly ReaderDirectoryFilterDto[]
  treeOpen: boolean
  canTree: boolean
  inlineTreeOpen: boolean
  multiSelectMode: boolean
  sort?: ReaderDirectorySortDto
  sortFields?: readonly ReaderDirectorySortFieldDto[]
  sortSource?: ReaderDirectorySortSourceDto
  sortTemporary?: boolean
  canSort: boolean
  canSortPreference: boolean
  emptyArea: ReaderFolderEmptyAreaConfig
  pasteAvailable: boolean
  pasteRunning: boolean
  pasteProgress?: { processed: number; total: number }
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
  onThumbnailWidthChange(value: number): void
  onCommitThumbnailWidth(value: number): void
  onBannerWidthChange(value: number): void
  onCommitBannerWidth(value: number): void
  onToggleSearch(): void
  onChangeTypeFilter?(filter: ReaderDirectoryFilterDto): void
  onToggleTree(): void
  onToggleInlineTree(): void
  onToggleMultiSelect(): void
  onUpdateSort(sort: ReaderDirectorySortDto): void
  onUpdateSortPreference(command: ReaderDirectorySortPreferenceCommandDto): void
  onEmptyAreaChange(patch: Partial<ReaderFolderEmptyAreaConfig>): void
  onPaste(): void
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
    thumbnailWidthPercent,
    bannerWidthPercent,
    searchOpen,
    canFilter,
    typeFilter = "library",
    filterOptions,
    treeOpen,
    canTree,
    inlineTreeOpen,
    multiSelectMode,
    sort,
    sortFields,
    sortSource,
    sortTemporary,
    canSort,
    canSortPreference,
    emptyArea,
    pasteAvailable,
    pasteRunning,
    pasteProgress,
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
    onThumbnailWidthChange,
    onCommitThumbnailWidth,
    onBannerWidthChange,
    onCommitBannerWidth,
    onToggleSearch,
    onChangeTypeFilter,
    onToggleTree,
    onToggleInlineTree,
    onToggleMultiSelect,
    onUpdateSort,
    onUpdateSortPreference,
    onEmptyAreaChange,
    onPaste,
    onRefreshVisibleThumbnails,
    onRefreshSelectedThumbnails,
    onCancelThumbnailRefresh,
  } = props

  const busy = disabled || loading
  const currentView = viewModeOptions.find((option) => option.value === viewMode) ?? viewModeOptions[0]!
  const CurrentViewIcon = currentView.icon
  const sizeEnabled = viewUsesThumbnailGrid(viewMode) || viewUsesBanner(viewMode)
  const thumbsEnabled = viewUsesThumbnails(viewMode)
  const pasteLabel = pasteRunning && pasteProgress
    ? `正在粘贴 ${pasteProgress.processed} / ${pasteProgress.total}`
    : "粘贴到当前目录"
  const sortFieldLabel = sort ? sortLabels[sort.field] : "排序"
  const sortOrderLabel = sort?.order === "asc" ? "升序" : "降序"
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
                  {sort.order === "asc" ? <ArrowUp /> : <ArrowDown />}
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
            label={multiSelectMode ? "退出多选" : "多选模式"}
            disabled={!currentPath || busy}
            active={multiSelectMode}
            onClick={onToggleMultiSelect}
          >
            <CheckSquare />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={pasteLabel}
            disabled={!currentPath || busy || !pasteAvailable || pasteRunning}
            onClick={onPaste}
          >
            <ClipboardPaste />
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
              variant={typeFilterActive || hoverPreviewEnabled === false ? "secondary" : "ghost"}
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
                  {viewUsesThumbnailGrid(viewMode) ? (
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
    </div>
  )
}

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
