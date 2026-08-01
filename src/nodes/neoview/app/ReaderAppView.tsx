import { lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEventHandler } from "react"
import { BookOpen, ChevronRight, LoaderCircle, Pin, PinOff, X } from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  DEFAULT_READER_INPUT_BINDINGS,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  READER_INPUT_ACTION_LABELS,
  ReaderSlideshow,
  type ReaderPresentation,
  type ReaderInputAction,
  type ReaderInputActionExecutionContext,
  type ReaderInputActionOutcome,
  type ReaderInputBindingsConfig,
  type ReaderRadialMenuConfig,
  type ReaderVoiceControlConfig,
} from "@xiranite/node-neoview/ui-core"
import { Button } from "@/components/ui/button"
import { useContextMenu } from "@/components/context-menu"
import { cn } from "@/lib/utils"
import { FloatingWindowCaptionControls, FloatingWindowTitlebarReservation, useFloatingWindowFrame } from "@/components/workspace/FloatingWindowFrame"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { useSwimlaneSessionStore } from "@/store/swimlaneSessionStore"
import type { SwimlaneWorkspaceSessionState } from "@xiranite/shared/swimlane"
import {
  createReaderHttpClient,
  READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
  ReaderHttpError,
  type ReaderHttpClient,
  type ReaderBookmarkListPreferencesDto,
  type ReaderBookmarkListPreferencesPatch,
  type ReaderHistoryListPreferencesDto,
  type ReaderHistoryListPreferencesPatch,
  type ReaderNavigationDto,
  type ReaderBookSettingsUpdateDto,
  type ReaderBookDefaultsDto,
  type ReaderPageOrderDto,
  type ReaderRuntimeConfigDto,
  type ReaderMediaConfigDto,
  type ReaderMediaPatchDto,
  type ReaderImageProcessingConfigDto,
  type ReaderSubtitleConfigDto,
  type ReaderPageListPreferencesDto,
  type ReaderSessionDto,
  type ReaderShellConfigDto,
  type ReaderSidebarLayoutPatch,
  type ReaderCardLayoutPatch,
  type ReaderBoardLayoutPatch,
  type ReaderViewDefaultsPatch,
  type ReaderFolderViewConfig,
  type ReaderFolderViewPatch,
  type ReaderSlideshowConfig,
  type ReaderSlideshowPatch,
  type ReaderShellControlPatch,
  type ReaderShellMaterialPatch,
  type ReaderShellEdge,
  type ReaderShellLockMode,
  type ReaderInputBindingsPatch,
  type ReaderRadialMenuPatch,
  type ReaderVoiceControlPatch,
  type ReaderSettingsMigrationImportResult,
  type ReaderSettingsMigrationInspection,
  type ReaderSwimlaneId,
} from "../adapters/reader-http-client"
import { useReaderSpeculativePreloadGate } from "../features/reader/useReaderSpeculativePreloadGate"
import { mergeReaderFolderViewPatch } from "./ReaderFolderViewPersistence"
import { persistReaderRadialMenu } from "./ReaderRadialMenuPersistence"
import { useReaderImagePreloader } from "../features/reader/useReaderImagePreloader"
import { watchReaderSourceChanges } from "../features/reader/watchReaderSourceChanges"
import { neoviewDebug, neoviewDebugAsync } from "../neoviewDebug"
import { ReaderControlledEdgeShell, type ReaderControlledEdgeSlot } from "../features/shell/ReaderControlledEdgeShell"
import { createReaderShellControlStore, type ReaderShellControlHydration, type ReaderShellControlSnapshot } from "../features/shell/ReaderShellControlStore"
import type { ReaderShellControlPort } from "../features/shell/ReaderShellControlPort"
import { ReaderWindowBar } from "../features/shell/ReaderWindowBar"
import { ThumbnailStrip } from "../features/thumbnails/ThumbnailStrip"
import { useReaderInputRouter } from "../features/input/ReaderInputRouter"
import { createReaderCursorAutoHideActionPort, mergeReaderViewDefaults } from "./ReaderViewDefaultsPersistence"
import { executeReaderInputAction } from "../features/input/ReaderInputActionExecutor"
import { readerCurrentFileDeleteConfirmation } from "../features/input/ReaderCurrentFileDeleteConfirmation"
import { createReaderColorFilterStore } from "../features/color-filter/ReaderColorFilterStore"
import { migrateLegacyReaderColorFilter } from "../features/color-filter/LegacyReaderColorFilterMigration"
import { commitReaderNavigation, createReaderPageTransitionStore } from "../features/page-transition/ReaderPageTransitionStore"
import { ReaderVideoController } from "../features/video/ReaderVideoController"
import { ReaderViewerToggleStore } from "../features/viewer/ReaderViewerToggleStore"
import { migrateLegacyReaderPageTransition } from "../features/page-transition/LegacyReaderPageTransitionMigration"
import { migrateLegacySidebarHeight } from "../features/panels/cards/LegacySidebarHeightMigration"
import { applyReaderFilePresentationOverridePatch } from "../features/panels/readerFilePresentation"
import { ReaderPanelDndProvider } from "../features/panels/ReaderPanelDnd"
import { readerShellMaterialDraft, readerShellMaterialStyle } from "../features/material/ReaderShellMaterial"
import { createReaderSwitchToastStore } from "../features/switch-toast/ReaderSwitchToastStore"
import { createReaderInfoOverlayStore } from "../features/info-overlay/ReaderInfoOverlayStore"
import { createReaderImageTrimStore } from "../features/image-trim/ReaderImageTrimStore"
import { useDeferredFinalCleanup } from "../features/settings/useDeferredFinalCleanup"
import { ReaderSwimlaneErrorBoundary, ReaderSwimlaneWorkspace } from "../features/workspace/ReaderSwimlaneWorkspace"
import { applyReaderWorkspacePatch, fitReaderSwimlanesToViewport, readerWorkspaceConfig, type ReaderWorkspaceConfig, type ReaderWorkspacePatch } from "../features/workspace/ReaderWorkspaceLayout"
import { createInitialReaderShellConfig, readerShellSnapshotsEqual } from "./ReaderShellSnapshot"
import { useReaderWorkspaceRestoreStore } from "./ReaderWorkspaceRestoreStore"
import { ReaderStartupRestorePreferenceProvider } from "./ReaderStartupRestorePreferenceContext"
import { workspaceConfigEqual, readerWorkspaceWithSession, splitReaderWorkspacePatch, INITIAL_VIEW_DEFAULTS, INITIAL_HISTORY_LIST_PREFERENCES, INITIAL_BOOKMARK_LIST_PREFERENCES, INITIAL_PAGE_LIST_PREFERENCES, INITIAL_BOOK_DEFAULTS, INITIAL_SLIDESHOW_CONFIG, INITIAL_PRELOAD_CONFIG, INITIAL_FOLDER_VIEW_CONFIG, loadReaderSidebar, LazyReaderSidebar, LazyReaderGestureInputRuntime, LazyReaderRadialMenuOverlay, LazyReaderSettingsWindow, loadReaderFrame, LazyReaderFrame, LazyReaderBackgroundLayer, LazyReaderViewToolbar, LazyReaderSwitchToastRuntime, LazyReaderInfoOverlayRuntime, loadReaderPresentation, DeferredSidebarFloatingController, shellControlHydration, shellControlSnapshot, defaultShellControlSnapshot, edgeSurfaceStyle, readerPathSegments, fileMutationContainsSource, applyNavigation, waitForReaderOperationIdle, errorMessage } from "./ReaderAppModules"
import type { ReaderAppProps } from "./ReaderAppModules"
import { isSameReaderPath, relocateReaderActivationIdentity } from "./ReaderActivationIdentity"

export function ReaderAppView({ context }: { context: any }) {
  const {
    sessionScopeId,
    pickFile,
    pickDirectory,
    pickEfuFile,
    copyText,
    readFiles,
    copyFiles,
    clearFiles,
    onReaderViewFullscreenCommitted,
    inputRouter,
    handleInputPointerDown,
    surface,
    floatingFrame,
    contextMenu,
    swimlaneSessionScopeId,
    swimlaneSession,
    patchSwimlaneSession,
    readerBootedAtRef,
    client,
    clientRef,
    shellRef,
    readerInteractionRef,
    sessionRef,
    operationRef,
    openOperationRef,
    activeSourcePathRef,
    relocateActivationPath,
    navigationPendingRef,
    slideshowSessionRef,
    slideshow,
    viewDefaultsRef,
    confirmedViewDefaultsRef,
    tailOverflowRef,
    viewDefaultsWriteQueueRef,
    viewDefaultsGenerationRef,
    pageListPreferencesRef,
    confirmedPageListPreferencesRef,
    pageListPreferencesWriteQueueRef,
    pageListPreferencesGenerationRef,
    bookmarkListPreferencesGenerationRef,
    historyListPreferencesGenerationRef,
    slideshowConfigRef,
    confirmedSlideshowConfigRef,
    slideshowWriteQueueRef,
    slideshowGenerationRef,
    folderViewRef,
    confirmedFolderViewRef,
    folderViewWriteQueueRef,
    folderViewGenerationRef,
    inputBindingsRef,
    lastInputPointRef,
    temporaryFitPresentationRef,
    shellControlWriteQueueRef,
    shellControlGenerationRef,
    pendingWorkspaceWritesRef,
    presentationTouchedRef,
    path,
    setPath,
    browserOriginPath,
    setBrowserOriginPath,
    session,
    setSession,
    busy,
    setBusy,
    error,
    setError,
    colorFilter,
    pageTransition,
    switchToast,
    infoOverlay,
    imageTrim,
    videoController,
    viewerToggles,
    shell,
    setShell,
    readerChromeReady,
    setReaderChromeReady,
    shellControlStore,
    shellControl,
    viewDefaults,
    setViewDefaults,
    bookDefaults,
    setBookDefaults,
    pageListPreferences,
    setPageListPreferences,
    bookmarkListPreferences,
    setBookmarkListPreferences,
    historyListPreferences,
    setHistoryListPreferences,
    folderView,
    setFolderView,
    inputBindings,
    setInputBindings,
    radialMenu,
    setRadialMenu,
    voiceControl,
    setVoiceControl,
    media,
    setMedia,
    imageProcessing,
    setImageProcessing,
    slideshowConfig,
    setSlideshowConfig,
    preloadConfig,
    setPreloadConfig,
    slideshowFadeFrame,
    setSlideshowFadeFrame,
    superResolution,
    setSuperResolution,
    radialMenuRequest,
    setRadialMenuRequest,
    settingsOpen,
    setSettingsOpen,
    presentation,
    setPresentation,
    magnifierEnabled,
    setMagnifierEnabled,
    readerViewFullscreen,
    setReaderViewFullscreen,
    swimlaneSidebarsReady,
    setSwimlaneSidebarsReady,
    swimlaneRightSidebarReady,
    setSwimlaneRightSidebarReady,
    readerFrameAllowed,
    setReaderFrameAllowed,
    browserPredecodeEnabled,
    prefetchController,
    speculativePreloadAllowed,
    cancelledPreloadFrame,
    setCancelledPreloadFrame,
    openPath,
    folderNavigationEvents,
    browsePath,
    activateInFolderCard,
    openFolderPathInNewTab,
    updateActiveDirectorySort,
    externalFolderOpenRequest,
    onExternalFolderOpenResult,
    navigate,
    goTo,
    requestShellEdgeOpen,
    setShellEdgePinned,
    cycleShellEdgeLock,
    setShellEdgeLock,
    setShellFloatingControl,
    setShellEdgeTriggerSize,
    resetShellControl,
    persistShellControl,
    persistSubtitleConfig,
    persistVideoControlsPinned,
    persistAnimatedVideoMode,
    explorerContextMenuPreview,
    explorerContextMenuStatus,
    setExplorerContextMenuEnabled,
    repairExplorerContextMenu,
    persistSuperResolutionConfig,
    persistSuperResolution,
    runPreloadAction,
    updateNavigation,
    applyBookSettingsUpdate,
    updatePresentation,
    updatePageMode,
    updateSessionLayout,
    updateReadingDirection,
    updateReadingDirectionLock,
    updateCurrentPageOrder,
    updatePageOrderLocks,
    updateCurrentBookPageMode,
    updateCurrentBookReadingDirection,
    persistHistoryListPreferences,
    persistBookmarkListPreferences,
    persistPageListPreferences,
    persistViewDefaults,
    applyConfiguredViewDefaults,
    persistInputBindings,
    persistRadialMenu,
    persistVoiceControl,
    inspectLegacySettings,
    importLegacySettings,
    persistSlideshow,
    persistFolderView,
    closeSession,
    deleteThroughInputBinding,
    undoFileDeletion,
    requestDeleteCurrentFile,
    toggleWorkspaceMode,
    focusAdjacentWorkspaceLane,
    toggleActiveWorkspaceLaneFullscreen,
    fitWorkspaceLanes,
    commitWorkspace,
    currentReaderWorkspace,
    commitSwimlaneSessionPatch,
    applyConfirmedShell,
    enqueueShellControl,
    commitSidebarLayout,
    commitCardLayout,
    commitBoardLayout,
    commitDraggedPanelLayout,
    persistImageProcessing,
    persistPreload,
    enqueueShellMutation,
    refreshLatestShell,
    commitShellMaterial,
    executeInputAction,
    applyInputPresentation,
    switchAdjacentBook,
    toggleTemporaryFit,
    toggleSinglePanorama,
    syncPanoramaVisiblePage,
    toggleFullscreen,
    toggleShellEdge,
    toggleShellPin,
    toggleSidebarControl,
    openRadialMenu,
  } = context

  async function choose(source: "file" | "directory") {
      const selected = source === "file" ? await pickFile?.() : await pickDirectory?.()
      if (selected) {
        setPath(selected)
        await openPath(selected)
      }
    }
  
    const compact = surface.mode === "collapsed" || surface.mode === "compact" || surface.mode === "portrait"
    const frame = session?.frame
    const pathSegments = readerPathSegments(path)
    const workspace = shell ? readerWorkspaceWithSession(shell, swimlaneSession) : undefined
    // Bootstrap with the complete swimlane shell so a failed config request
    // cannot strand the compiled app on the workspace loading screen.
    const workspaceMode = workspace?.mode
    const workspaceLayoutPending = workspaceMode === undefined
    const readerOwnsSoloViewport = workspace?.swimlane.soloLaneId === "reader"
      || workspace?.swimlane.readerSolo === true
  
    const toggleReaderViewFullscreen = () => {
      const next = !readerViewFullscreen
      setReaderViewFullscreen(next)
      useReaderWorkspaceRestoreStore.getState().patchRestore({ readerViewFullscreen: next })
      onReaderViewFullscreenCommitted?.(next)
      commitWorkspace(next
        ? { activeLane: "reader", readerSolo: true, soloLaneId: "reader", lanes: { reader: { collapsed: false } } }
        : { readerSolo: false, soloLaneId: null })
    }
    const readerTopbarLeadingControls = (
      <ReaderWindowBar
        control={shellControl}
        disabled={!shell}
        mode={workspaceMode}
        onModeChange={(mode) => commitWorkspace({ mode })}
        onOpenSettings={() => setSettingsOpen(true)}
        part="leading"
      />
    )
    const readerTopbarTrailingControls = (
      <ReaderWindowBar
        control={shellControl}
        disabled={!shell}
        mode={workspaceMode}
        readerViewFullscreen={readerViewFullscreen}
        onModeChange={(mode) => commitWorkspace({ mode })}
        onReaderViewFullscreenChange={toggleReaderViewFullscreen}
        onOpenSettings={() => setSettingsOpen(true)}
        windowControls={workspaceMode === "edges" || readerOwnsSoloViewport ? <FloatingWindowCaptionControls integrated /> : undefined}
        part="trailing"
      />
    )
    const topEdge: ReaderControlledEdgeSlot = {
      ariaLabel: "NeoView 顶部工具栏",
      triggerSize: shell?.edges.top.triggerSize,
      triggerRect: workspace?.swimlane.edgeRevealZones.top,
      showDelayMs: shell?.showDelayMs,
      hideDelayMs: shell?.hideDelayMs,
      render: () => (
        <div
          className="border-b border-border/55 bg-background/94 text-foreground shadow-[0_10px_30px_rgb(0_0_0/0.22)] backdrop-blur-xl"
          data-reader-edge-chrome="top"
          style={edgeSurfaceStyle(shell, "top")}
        >
          <div
            className={cn("xiranite-app-region-drag min-h-11 select-none border-b border-border/45", compact ? "pl-1" : "pl-2")}
            data-reader-breadcrumb-bar="true"
            onDoubleClick={floatingFrame?.handleTitlebarDoubleClick}
          >
            {/* Idle and reading share the same three-column chrome; only the
                session-specific affordances (close/reopen, page index) change. */}
            <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)] items-center gap-1.5">
              <div className="xiranite-app-region-no-drag flex min-w-0 items-center justify-self-start">
                {session ? (
                  <Button className="border border-transparent bg-transparent text-foreground/80 shadow-none" aria-label="关闭书籍" type="button" size="icon-sm" variant="ghost" onClick={() => void closeSession()}><X /></Button>
                ) : path.trim() && readerChromeReady ? (
                  <Button
                    className="border border-transparent bg-transparent text-foreground/80 shadow-none"
                    aria-label="打开书籍"
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void openPath()}
                  >
                    {busy ? <LoaderCircle className="animate-spin" /> : <BookOpen />}
                  </Button>
                ) : null}
                {readerTopbarLeadingControls}
              </div>
              <nav
                className="flex min-w-0 items-center justify-center gap-1 overflow-hidden text-center"
                aria-label={session ? "当前书籍路径" : pathSegments.length ? "最近书籍路径" : "NeoView"}
                data-reader-breadcrumb-path="true"
              >
                {pathSegments.length ? pathSegments.map((segment, index) => (
                  <span className="contents" key={`${segment}-${index}`}>
                    {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/65" aria-hidden="true" /> : null}
                    <span className={cn("truncate text-xs", index === pathSegments.length - 1 ? "font-medium text-foreground" : "text-muted-foreground")}>{segment}</span>
                  </span>
                )) : (
                  <span className="truncate text-xs text-muted-foreground">NeoView</span>
                )}
              </nav>
              <div className="xiranite-app-region-no-drag flex min-w-0 items-stretch justify-self-end">
                {session ? (
                  <span className="hidden shrink-0 items-center px-1.5 text-[11px] tabular-nums text-muted-foreground lg:flex">{(frame?.anchorPageIndex ?? 0) + 1} / {session.book.pageCount}</span>
                ) : null}
                {readerTopbarTrailingControls}
              </div>
            </div>
          </div>
          {session ? (
            <Suspense fallback={null}>
              <LazyReaderViewToolbar
                disabled={busy}
                layout={frame?.layout ?? session.frame.layout}
                direction={frame?.direction ?? session.frame.direction}
                presentation={presentation}
                onChange={updatePresentation}
                onLayoutChange={(layout) => void updateSessionLayout(layout)}
                onDirectionChange={(direction) => void updateReadingDirection(direction)}
                lockedReadingDirection={bookDefaults.lockedReadingDirection}
                onDirectionLockChange={(direction) => void updateReadingDirectionLock(direction)}
                pageOrder={session.pageOrder ?? { sortMode: "fileName", mediaPriority: "none" }}
                lockedSortMode={bookDefaults.lockedSortMode}
                lockedMediaPriority={bookDefaults.lockedMediaPriority}
                onPageOrderChange={updateCurrentPageOrder}
                onPageOrderLockChange={updatePageOrderLocks}
                hoverScrollEnabled={viewDefaults.hoverScrollEnabled ?? true}
                hoverScrollSpeed={viewDefaults.hoverScrollSpeed ?? 2}
                onHoverScrollChange={(patch) => persistViewDefaults({
                  ...(patch.enabled === undefined ? {} : { hoverScrollEnabled: patch.enabled }),
                  ...(patch.speed === undefined ? {} : { hoverScrollSpeed: patch.speed }),
                })}
                magnifierEnabled={magnifierEnabled}
                magnifierZoom={viewDefaults.magnifierZoom ?? 2}
                magnifierSize={viewDefaults.magnifierSize ?? 200}
                onMagnifierEnabledChange={setMagnifierEnabled}
                onMagnifierConfigChange={(patch) => persistViewDefaults({
                  ...(patch.zoom === undefined ? {} : { magnifierZoom: patch.zoom }),
                  ...(patch.size === undefined ? {} : { magnifierSize: patch.size }),
                })}
                slideshow={slideshow}
                onSlideshowChange={persistSlideshow}
              
              />
            </Suspense>
          ) : null}
          {error ? <div role="alert" className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>
      ),
    }
  
    const bottomEdge: ReaderControlledEdgeSlot | undefined = shell?.edges.bottom.enabled ? {
      ariaLabel: "NeoView 底部缩略图与导航栏",
      triggerSize: shell?.edges.bottom.triggerSize,
      triggerRect: workspace?.swimlane.edgeRevealZones.bottom,
      showDelayMs: shell?.showDelayMs,
      hideDelayMs: shell?.hideDelayMs,
      render: () => (
        <div
          className="min-w-0 max-w-full overflow-x-hidden border-t border-border/55 bg-background/94 shadow-[0_-12px_30px_rgb(0_0_0/0.24)] backdrop-blur-xl"
          data-reader-edge-chrome="bottom"
          style={edgeSurfaceStyle(shell, "bottom")}
        >
          {session ? (
            <ThumbnailStrip
              sessionId={session.sessionId}
              totalPages={session.book.pageCount}
              activePageIndex={session.frame.anchorPageIndex}
              direction={session.frame.direction}
              currentPages={session.visiblePages}
              client={client}
              compact={compact}
              disabled={busy}
              pinned={shell.edges.bottom.pinned}
              onPinnedChange={(pinned) => shellControl.setPinned("bottom", pinned)}
              viewerToggles={viewerToggles}
              onSelect={goTo}
            />
          ) : (
            <div className="flex min-h-10 items-center justify-center gap-2 px-2 py-1" data-reader-bottom-bar="true" data-reader-bottom-empty="true">
              <Button type="button" size="sm" variant={shell.edges.bottom.pinned ? "default" : "ghost"} aria-label={shell.edges.bottom.pinned ? "取消钉住底栏" : "钉住底栏"} aria-pressed={shell.edges.bottom.pinned} onClick={() => shellControl.setPinned("bottom", !shell.edges.bottom.pinned)}>
                {shell.edges.bottom.pinned ? <Pin /> : <PinOff />}<span className="text-xs">{shell.edges.bottom.pinned ? "已钉住" : "钉住"}</span>
              </Button>
              <span className="text-xs text-muted-foreground">未打开书籍</span>
            </div>
          )}
        </div>
      ),
    } : undefined
    const relocateReaderSourcePath = (sourcePath: string, destinationPath: string) => {
      const identity = relocateActivationPath(sourcePath, destinationPath)
      setSession((current: typeof session) => {
        if (!current) return current
        const activeSource = isSameReaderPath(current.activationIdentity.readerSourcePath, sourcePath)
        const activationIdentity = relocateReaderActivationIdentity(current.activationIdentity, sourcePath, destinationPath)
        if (activationIdentity === current.activationIdentity && !activeSource) return current
        const displayName = destinationPath.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) || current.book.displayName
        return { ...current, activationIdentity, book: activeSource ? { ...current.book, displayName } : current.book }
      })
      setBrowserOriginPath(identity.traversalRootPath)
      if (!isSameReaderPath(path, sourcePath)) return
      setPath(destinationPath)
      activeSourcePathRef.current = destinationPath
    }
    const commitReaderSourcePathRelocation = async (sourcePath: string, destinationPath: string) => { await client.relocateLibrarySourcePath?.(sourcePath, destinationPath) }
    const panelContext = {
      client,
      disabled: busy,
      onGoTo: goTo,
      onBookSettingsUpdated: applyBookSettingsUpdate,
      onInputAction: executeInputAction,
      bookmarkListPreferences,
      onBookmarkListPreferences: persistBookmarkListPreferences,
      historyListPreferences,
      onHistoryListPreferences: persistHistoryListPreferences,
      pageListPreferences,
      onPageListPreferences: persistPageListPreferences,
      onPageModeChange: updateCurrentBookPageMode,
      onReadingDirectionChange: updateCurrentBookReadingDirection,
      onPreloadAction: runPreloadAction,
      sourcePath: path,
      browserOriginPath,
      pickDirectory,
      pickEfuFile,
      systemActions: {
        copyText,
        readFiles,
        copyFiles,
        clearFiles,
        revealPath: client.revealSystemPath,
      },
      onOpen: openPath,
      onSourcePathRelocated: relocateReaderSourcePath,
      onSourcePathRelocationCommitted: commitReaderSourcePathRelocation,
      onBrowsePath: browsePath,
      onDeleteThroughBinding: deleteThroughInputBinding,
      onUndoFileDeletion: undoFileDeletion,
      onActivateInFolderCard: activateInFolderCard,
      onOpenInNewTab: openFolderPathInNewTab,
      folderNavigationEvents,
      onActiveDirectorySortChange: updateActiveDirectorySort,
      externalFolderOpenRequest,
      onExternalFolderOpenResult,
      shell,
      shellControl,
      colorFilter,
      pageTransition,
      switchToast,
      infoOverlay,
      imageTrim,
      media,
      onMediaChange: persistAnimatedVideoMode,
      imageProcessing,
      onImageProcessingChange: persistImageProcessing,
      preload: preloadConfig,
      onPreload: persistPreload,
      slideshow: slideshowConfig,
      onSlideshow: persistSlideshow,
      inputBindings,
      onInputBindings: persistInputBindings,
      radialMenu,
      onRadialMenu: persistRadialMenu,
      voiceControl,
      onVoiceControl: persistVoiceControl,
      onMaterial: commitShellMaterial,
      onLegacySettingsInspect: inspectLegacySettings,
      onLegacySettingsImport: importLegacySettings,
      superResolution,
      onSuperResolutionChange: persistSuperResolution,
      onSuperResolutionConfigChange: persistSuperResolutionConfig,
      onSidebarLayout: commitSidebarLayout,
      onBoardLayout: commitBoardLayout,
      viewDefaults,
      onViewDefaults: applyConfiguredViewDefaults,
      folderView,
      onFolderView: persistFolderView,
      presentation,
      ...(session ? { session } : {}),
    }
    const externalFolderLaunchActive = Boolean(externalFolderOpenRequest)
    const leftEdge: ReaderControlledEdgeSlot | undefined = shell && (shell.edges.left.enabled || externalFolderLaunchActive) ? {
      ariaLabel: "NeoView 左侧面板",
      showDelayMs: shell?.showDelayMs ?? 80,
      hideDelayMs: shell?.hideDelayMs,
      triggerSize: shell?.edges.left.triggerSize,
      preload: () => void loadReaderSidebar(),
      render: (active) => (
        <Suspense fallback={<div className="h-full w-80 animate-pulse border-r border-border/70 bg-background/85" aria-label="正在加载左侧面板" />}>
          <LazyReaderSidebar side="left" context={panelContext} shell={shell} active={active} selectedPanelId={externalFolderLaunchActive ? "folder" : undefined} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
        </Suspense>
      ),
    } : undefined
    const rightEdge: ReaderControlledEdgeSlot | undefined = shell && shell.edges.right.enabled ? {
      ariaLabel: "NeoView 右侧面板",
      showDelayMs: shell?.showDelayMs ?? 80,
      hideDelayMs: shell?.hideDelayMs,
      triggerSize: shell?.edges.right.triggerSize,
      preload: () => void loadReaderSidebar(),
      render: (active) => (
        <Suspense fallback={<div className="h-full w-80 animate-pulse border-l border-border/70 bg-background/85" aria-label="正在加载右侧面板" />}>
          <LazyReaderSidebar side="right" context={panelContext} shell={shell} active={active} onLayoutCommit={(patch) => void commitSidebarLayout(patch)} onCardLayoutCommit={(patch) => void commitCardLayout(patch)} />
        </Suspense>
      ),
    } : undefined
    const readerCanvas = (
      <div
        ref={readerInteractionRef}
        className="relative h-full min-h-0 overflow-hidden"
        style={{ backgroundColor: (viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background).mode === "solid" ? (viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background).color : "#000000" }}
        data-reader-interaction-scope="true"
        data-input-context="reader"
        onPointerDown={handleInputPointerDown}
        onPointerUp={inputRouter.onPointerUp}
        onContextMenu={(event) => { if (radialMenuRequest) event.preventDefault() }}
      >
        {(viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background).mode !== "solid" && readerFrameAllowed ? (
          <Suspense fallback={null}>
            <LazyReaderBackgroundLayer
              config={viewDefaults.background ?? INITIAL_VIEW_DEFAULTS.background}
              imageSrc={session?.visiblePages.find((page) => page.mediaKind === "image")?.assetUrl}
            />
          </Suspense>
        ) : null}
        {radialMenuRequest ? <Suspense fallback={null}><LazyReaderRadialMenuOverlay config={radialMenu} request={radialMenuRequest} onClose={() => setRadialMenuRequest(undefined)} onSelect={({ menuId, itemId, legacyAction }) => { if (!inputRouter.dispatch({ device: "radial", menuId, itemId }, null) && legacyAction) void executeInputAction(legacyAction) }} /></Suspense> : null}
        {!session ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-white/55">
            <div>
              <BookOpen className="mx-auto mb-3 size-8 opacity-60" />
              <p>从文件夹、历史记录或播放列表打开漫画</p>
            </div>
          </div>
        ) : !readerFrameAllowed ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-white/55" data-reader-frame-deferred="true">
            <div>
              <LoaderCircle className="mx-auto mb-3 size-8 animate-spin opacity-70" />
              <p>正在准备页面…</p>
            </div>
          </div>
        ) : (
          <Suspense fallback={
            <div className="grid h-full place-items-center p-6 text-center text-sm text-white/55" data-reader-frame-loading="true">
              <LoaderCircle className="mx-auto size-8 animate-spin opacity-70" />
            </div>
          }>
            <LazyReaderFrame
              pages={session.visiblePages}
              framePages={session.frame.pages}
              presentation={presentation}
              panorama={session.frame.layout.panorama}
              pageMode={session.frame.layout.pageMode}
              doublePageGap={viewDefaults.doublePageGap ?? 0}
              direction={session.frame.direction}
              totalPages={session.book.pageCount}
              anchorPageIndex={session.frame.anchorPageIndex}
              preloadGeneration={session.preload?.generation}
              hoverScrollEnabled={viewDefaults.hoverScrollEnabled ?? true}
              hoverScrollSpeed={viewDefaults.hoverScrollSpeed ?? 2}
              magnifierEnabled={magnifierEnabled}
              magnifierZoom={viewDefaults.magnifierZoom ?? 2}
              magnifierSize={viewDefaults.magnifierSize ?? 200}
              mouseCursor={viewDefaults.mouseCursor}
              colorFilter={colorFilter}
              pageTransition={pageTransition}
              slideshowFade={slideshowFadeFrame === `${session.sessionId}:${session.frame.generation}`}
              videoController={videoController}
              sessionId={session.sessionId}
              client={client}
              media={media}
              superResolution={superResolution}
              speculativePreloadAllowed={speculativePreloadAllowed}
              viewerToggles={viewerToggles}
              onSubtitleConfigChange={persistSubtitleConfig}
              onVideoControlsPinnedChange={persistVideoControlsPinned}
              onVisiblePageChange={syncPanoramaVisiblePage}
              imageTrim={imageTrim}
              onVideoListEnded={() => void navigate("next")}
            />
          </Suspense>
        )}
        {busy && session ? <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white" data-reader-operation-busy="true"><LoaderCircle className="size-4 animate-spin" /></div> : null}
        {workspaceMode === "edges" && shell ? <DeferredSidebarFloatingController control={shellControl} shell={shell} disabled={busy} /> : null}
      </div>
    )
  
    return (
      <ReaderStartupRestorePreferenceProvider preference={context.startupRestore}>
      <div
        ref={surface.ref}
        data-reader-app="true"
        data-input-context="reader"
        data-context-menu-stop=""
        className="relative flex h-full min-h-0 w-full min-w-0 max-w-full touch-none flex-col overflow-hidden overscroll-none bg-background text-foreground outline-none [contain:layout_paint]"
        tabIndex={0}
      >
        <Suspense fallback={null}>
          <LazyReaderGestureInputRuntime config={inputBindings} disabled={busy} target={readerInteractionRef} claimPointer={inputRouter.claimPointer} dispatch={inputRouter.dispatch} />
        </Suspense>
        <Suspense fallback={null}>
          <LazyReaderSwitchToastRuntime port={switchToast} session={session} sourcePath={path} />
        </Suspense>
        <Suspense fallback={null}>
          <LazyReaderInfoOverlayRuntime port={infoOverlay} session={session} sourcePath={path} />
        </Suspense>
        <FloatingWindowTitlebarReservation />
        {workspaceLayoutPending ? (
          <div className="grid min-h-0 flex-1 place-items-center bg-background" data-neoview-workspace-mode="pending" data-reader-workspace-loading="true">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label="正在恢复阅读器布局" />
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-hidden" data-neoview-workspace-mode={workspaceMode}>
          <ReaderPanelDndProvider shell={shell} onMove={commitDraggedPanelLayout}>
            {workspaceMode === "swimlane" && shell && workspace ? (
              <ReaderSwimlaneErrorBoundary resetKey={`${workspaceMode}:${shell.revision ?? 0}`} onReturnToEdges={() => commitWorkspace({ mode: "edges" })}>
                <ReaderSwimlaneWorkspace
                  shell={shell}
                  workspace={workspace}
                  disabled={!shell}
                  readerViewFullscreen={readerViewFullscreen}
                  onReaderViewFullscreenChange={toggleReaderViewFullscreen}
                  windowChrome={floatingFrame && !readerOwnsSoloViewport ? {
                    controls: <FloatingWindowCaptionControls integrated density="compact" />,
                    onTitlebarDoubleClick: floatingFrame.handleTitlebarDoubleClick,
                  } : undefined}
                  onWorkspaceChange={commitWorkspace}
                  onOpenSettings={() => setSettingsOpen(true)}
                  reader={(
                    <ReaderControlledEdgeShell store={shellControlStore} edges={{ top: topEdge, bottom: bottomEdge }}>
                      {readerCanvas}
                    </ReaderControlledEdgeShell>
                  )}
                  left={swimlaneSidebarsReady ? (
                    <Suspense fallback={<div className="h-full w-full animate-pulse bg-background/85" aria-label="正在加载左侧泳道" data-sidebar-deferred="left-loading" />}>
                      <LazyReaderSidebar
                        side="left"
                        presentation="lane"
                        context={panelContext}
                        shell={shell}
                        selectedPanelId={externalFolderLaunchActive ? "folder" : workspace.swimlane.lanes.left.activePanelId}
                        onSelectedPanelChange={(activePanelId) => commitWorkspace({ lanes: { left: { activePanelId } } })}
                        onPanelBarChange={(patch) => commitWorkspace({ lanes: { left: patch } })}
                        onCardLayoutCommit={(patch) => void commitCardLayout(patch)}
                      />
                    </Suspense>
                  ) : (
                    <div className="h-full w-full animate-pulse bg-background/70" aria-label="左侧泳道待加载" data-sidebar-deferred="left" />
                  )}
                  right={swimlaneRightSidebarReady ? (
                    <Suspense fallback={<div className="h-full w-full animate-pulse bg-background/85" aria-label="正在加载右侧泳道" data-sidebar-deferred="right-loading" />}>
                      <LazyReaderSidebar
                        side="right"
                        presentation="lane"
                        context={panelContext}
                        shell={shell}
                        selectedPanelId={workspace.swimlane.lanes.right.activePanelId}
                        onSelectedPanelChange={(activePanelId) => commitWorkspace({ lanes: { right: { activePanelId } } })}
                        onPanelBarChange={(patch) => commitWorkspace({ lanes: { right: patch } })}
                        onCardLayoutCommit={(patch) => void commitCardLayout(patch)}
                      />
                    </Suspense>
                  ) : (
                    <div className="h-full w-full animate-pulse bg-background/70" aria-label="右侧泳道待加载" data-sidebar-deferred="right" />
                  )}
                />
              </ReaderSwimlaneErrorBoundary>
            ) : (
              <ReaderControlledEdgeShell store={shellControlStore} edges={{ top: topEdge, right: rightEdge, bottom: bottomEdge, left: leftEdge }}>
                {readerCanvas}
              </ReaderControlledEdgeShell>
            )}
          </ReaderPanelDndProvider>
        </div>
        )}
        {settingsOpen && shell ? (
          <Suspense fallback={null}>
            <LazyReaderSettingsWindow
              portalContainer={surface.ref.current}
              shell={shell}
              viewDefaults={viewDefaults}
              slideshow={slideshowConfig}
              media={media}
              imageProcessing={imageProcessing}
              preload={preloadConfig}
              inputBindings={inputBindings}
              radialMenu={radialMenu}
              onClose={() => setSettingsOpen(false)}
              onBoardLayout={commitBoardLayout}
              onViewDefaults={applyConfiguredViewDefaults}
              onSlideshow={persistSlideshow}
              onMedia={persistAnimatedVideoMode}
              explorerIntegration={{
                preview: explorerContextMenuPreview,
                status: explorerContextMenuStatus,
                setEnabled: setExplorerContextMenuEnabled,
                repair: repairExplorerContextMenu,
              }}
              onImageProcessing={persistImageProcessing}
              onPreload={persistPreload}
              onInputBindings={persistInputBindings}
              onRadialMenu={persistRadialMenu}
              onLegacySettingsInspect={inspectLegacySettings}
              onLegacySettingsImport={importLegacySettings}
              onMaterial={commitShellMaterial}
              onWorkspace={commitWorkspace}
            />
          </Suspense>
        ) : null}
      </div>
      </ReaderStartupRestorePreferenceProvider>
    )
}
