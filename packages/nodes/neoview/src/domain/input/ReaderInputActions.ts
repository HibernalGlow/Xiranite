export const READER_INPUT_ACTION_CATEGORIES = [
  "navigation", "zoom", "view", "radial", "file", "video", "upscale", "slideshow", "viewer-toggle", "session",
] as const

export type ReaderInputActionCategory = typeof READER_INPUT_ACTION_CATEGORIES[number]

export interface ReaderInputActionDefinition {
  id: string
  legacyId?: string
  label: string
  category: ReaderInputActionCategory
}

export type ReaderInputActionMetadata = Omit<ReaderInputActionDefinition, "id">

const LEGACY_READER_INPUT_ACTION_DEFINITIONS = [
  action("reader.next-page", "nextPage", "下一页", "navigation"),
  action("reader.previous-page", "prevPage", "上一页", "navigation"),
  action("reader.first-page", "firstPage", "第一页", "navigation"),
  action("reader.last-page", "lastPage", "最后一页", "navigation"),
  action("reader.page-left", "pageLeft", "向左翻页", "navigation"),
  action("reader.page-right", "pageRight", "向右翻页", "navigation"),
  action("reader.next-book", "nextBook", "下一个书籍", "navigation"),
  action("reader.previous-book", "prevBook", "上一个书籍", "navigation"),

  action("reader.zoom-in", "zoomIn", "放大", "zoom"),
  action("reader.zoom-out", "zoomOut", "缩小", "zoom"),
  action("reader.fit-window", "fitWindow", "适应窗口", "zoom"),
  action("reader.actual-size", "actualSize", "实际大小", "zoom"),
  action("reader.toggle-temporary-fit", "toggleTemporaryFitZoom", "临时适应窗口", "zoom"),

  action("reader.fullscreen", "fullscreen", "全屏", "view"),
  action("shell.toggle-left-sidebar", "toggleLeftSidebar", "左侧边栏", "view"),
  action("shell.toggle-right-sidebar", "toggleRightSidebar", "右侧边栏", "view"),
  action("reader.toggle-library", "toggleLibrary", "快捷书库", "view"),
  action("shell.toggle-top-toolbar-pin", "toggleTopToolbarPin", "固定顶部工具栏", "view"),
  action("shell.toggle-bottom-thumbnail-pin", "toggleBottomThumbnailBarPin", "固定底部缩略图栏", "view"),
  action("reader.toggle-reading-direction", "toggleReadingDirection", "阅读方向切换", "view"),
  action("reader.toggle-book-mode", "toggleBookMode", "书籍模式", "view"),
  action("reader.rotate-clockwise", "rotate", "旋转", "view"),
  action("reader.rotate-180", "rotate180", "旋转180度", "view"),
  action("reader.toggle-single-panorama", "toggleSinglePanoramaView", "单页切换", "view"),

  action("radial.open-default", "openRadialMenu.default", "打开轮盘菜单", "radial"),
  action("radial.confirm", "radialMenu.confirm", "确认轮盘选择", "radial"),

  action("file.open", "openFile", "打开文件", "file"),
  action("file.close", "closeFile", "关闭文件", "file"),
  action("file.delete-current", "deleteFile", "删除文件", "file"),
  action("file.delete-current-page", "deleteCurrentPage", "删除当前页", "file"),

  action("video.play-pause", "videoPlayPause", "视频播放/暂停", "video"),
  action("video.seek-forward", "videoSeekForward", "视频快进10秒", "video"),
  action("video.seek-backward", "videoSeekBackward", "视频快退10秒", "video"),
  action("video.toggle-mute", "videoToggleMute", "视频静音切换", "video"),
  action("video.cycle-loop-mode", "videoToggleLoopMode", "视频循环模式切换", "video"),
  action("video.volume-up", "videoVolumeUp", "视频音量增加", "video"),
  action("video.volume-down", "videoVolumeDown", "视频音量降低", "video"),
  action("video.speed-up", "videoSpeedUp", "视频倍速增加", "video"),
  action("video.speed-down", "videoSpeedDown", "视频倍速降低", "video"),
  action("video.toggle-speed", "videoSpeedToggle", "视频倍速切换", "video"),
  action("video.toggle-seek-mode", "videoSeekModeToggle", "视频快进模式切换", "video"),

  action("upscale.toggle-auto", "toggleAutoUpscale", "自动超分开关", "upscale"),
  action("slideshow.toggle", "slideshowToggle", "幻灯片开关", "slideshow"),
  action("slideshow.play-pause", "slideshowPlayPause", "幻灯片播放/暂停", "slideshow"),
  action("slideshow.stop", "slideshowStop", "幻灯片停止", "slideshow"),
  action("slideshow.skip", "slideshowSkip", "幻灯片跳过", "slideshow"),

  action("viewer.toggle-dynamic-background", "viewer.toggleDynamicBackground", "动态背景开关", "viewer-toggle"),
  action("viewer.cycle-background-mode", "viewer.cycleBackgroundMode", "循环背景模式", "viewer-toggle"),
  action("viewer.toggle-page-info", "viewer.togglePageInfo", "页码信息开关", "viewer-toggle"),
  action("viewer.toggle-progress-bar", "viewer.toggleProgressBar", "进度条开关", "viewer-toggle"),
  action("viewer.toggle-page-switch-toast", "viewer.togglePageSwitchToast", "翻页提示开关", "viewer-toggle"),
  action("viewer.toggle-book-switch-toast", "viewer.toggleBookSwitchToast", "切书提示开关", "viewer-toggle"),
  action("viewer.toggle-boundary-toast", "viewer.toggleBoundaryToast", "边界提示开关", "viewer-toggle"),
  action("viewer.toggle-info-overlay", "viewer.toggleInfoOverlay", "信息浮层开关", "viewer-toggle"),
  action("viewer.toggle-hover-scroll", "viewer.toggleHoverScroll", "悬停滚动开关", "viewer-toggle"),
  action("viewer.toggle-sidebar-control", "viewer.toggleSidebarControl", "侧边浮动控制开关", "viewer-toggle"),
  action("viewer.toggle-cursor-auto-hide", "viewer.toggleCursorAutoHide", "光标自动隐藏开关", "viewer-toggle"),
  action("viewer.toggle-progress-bar-glow", "viewer.toggleProgressBarGlow", "进度条发光开关", "viewer-toggle"),
  action("viewer.toggle-render-mode", "viewer.toggleRenderMode", "渲染模式切换", "viewer-toggle"),
  action("viewer.cycle-auto-rotate", "viewer.toggleAutoRotate", "自动旋转模式切换", "viewer-toggle"),
  action("upscale.toggle-tile", "upscale.toggleTile", "Tile Toggle", "upscale"),
] as const satisfies readonly ReaderInputActionDefinition[]

const XR_READER_INPUT_ACTION_DEFINITIONS = [
  action("reader.reset-view", undefined, "重置视图", "view"),
  action("reader.open-settings", undefined, "打开设置", "session"),
] as const satisfies readonly ReaderInputActionDefinition[]

export const READER_INPUT_ACTION_DEFINITIONS = [
  ...LEGACY_READER_INPUT_ACTION_DEFINITIONS,
  ...XR_READER_INPUT_ACTION_DEFINITIONS,
] as const

export type ReaderInputAction = typeof READER_INPUT_ACTION_DEFINITIONS[number]["id"]

export const READER_INPUT_ACTIONS: readonly ReaderInputAction[] = READER_INPUT_ACTION_DEFINITIONS.map((definition) => definition.id)

export const READER_INPUT_ACTION_METADATA: Readonly<Record<ReaderInputAction, ReaderInputActionMetadata>> = Object.fromEntries(
  READER_INPUT_ACTION_DEFINITIONS.map(({ id, ...metadata }) => [id, metadata]),
) as Record<ReaderInputAction, ReaderInputActionMetadata>

export const READER_INPUT_ACTION_LABELS: Readonly<Record<ReaderInputAction, string>> = Object.fromEntries(
  READER_INPUT_ACTION_DEFINITIONS.map(({ id, label }) => [id, label]),
) as Record<ReaderInputAction, string>

export const LEGACY_READER_INPUT_ACTION_MAP: Readonly<Record<string, ReaderInputAction>> = Object.fromEntries(
  LEGACY_READER_INPUT_ACTION_DEFINITIONS.map(({ id, legacyId }) => [legacyId, id]),
)

export function readerInputActionFromLegacyId(legacyId: string): ReaderInputAction | undefined {
  return LEGACY_READER_INPUT_ACTION_MAP[legacyId]
}

function action<const Id extends string, const LegacyId extends string | undefined>(
  id: Id,
  legacyId: LegacyId,
  label: string,
  category: ReaderInputActionCategory,
): { id: Id; legacyId: LegacyId; label: string; category: ReaderInputActionCategory } {
  return { id, legacyId, label, category }
}
