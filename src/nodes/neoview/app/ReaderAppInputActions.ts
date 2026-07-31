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
import { useReaderAdjacentPagePreloader } from "../features/reader/useReaderAdjacentPagePreloader"
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
import { workspaceConfigEqual, readerWorkspaceWithSession, splitReaderWorkspacePatch, INITIAL_VIEW_DEFAULTS, INITIAL_HISTORY_LIST_PREFERENCES, INITIAL_BOOKMARK_LIST_PREFERENCES, INITIAL_PAGE_LIST_PREFERENCES, INITIAL_BOOK_DEFAULTS, INITIAL_SLIDESHOW_CONFIG, INITIAL_PRELOAD_CONFIG, INITIAL_FOLDER_VIEW_CONFIG, loadReaderSidebar, LazyReaderSidebar, LazyReaderGestureInputRuntime, LazyReaderRadialMenuOverlay, LazyReaderSettingsWindow, loadReaderFrame, LazyReaderFrame, LazyReaderBackgroundLayer, LazyReaderViewToolbar, LazyReaderSwitchToastRuntime, LazyReaderInfoOverlayRuntime, loadReaderPresentation, DeferredSidebarFloatingController, shellControlHydration, shellControlSnapshot, defaultShellControlSnapshot, edgeSurfaceStyle, readerPathSegments, fileMutationContainsSource, applyNavigation, waitForReaderOperationIdle, errorMessage } from "./ReaderAppModules"
import type { ReaderAppProps } from "./ReaderAppModules"

export function createReaderAppInputActions(context: any) {
  const {
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
    commitOpenedSession,
    navigationPendingRef,
    adjacentBookPendingRef,
    adjacentBookSortRef,
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
  } = context

  function executeInputAction(action: ReaderInputAction, context: ReaderInputActionExecutionContext): Promise<ReaderInputActionOutcome> {
      if (switchToast.getSnapshot().enableAction) {
        switchToast.show({ title: `操作：${READER_INPUT_ACTION_LABELS[action]}` })
      }
      return executeReaderInputAction(action, {
        session: () => session ? {
          pageCount: session.book.pageCount,
          pageIndex: session.frame.anchorPageIndex,
          direction: session.frame.direction,
          pageMode: session.frame.layout.pageMode,
        } : undefined,
        presentation: () => presentation,
        setPresentation: applyInputPresentation,
        navigate: (direction) => navigate(direction, false, true),
        goTo: (pageIndex) => goTo(pageIndex, false, true),
        switchBook: switchAdjacentBook,
        updatePageMode,
        updateReadingDirection: updateCurrentBookReadingDirection,
        toggleTemporaryFit,
        toggleSinglePanorama,
        toggleFullscreen,
        toggleShellEdge,
        toggleShellPin,
        toggleSidebarControl,
        toggleInlineBranchExpansion: () => persistFolderView({ penetration: { expandBranchesInline: !folderViewRef.current.penetration.expandBranchesInline } }),
        workspace: {
          toggleLayoutMode: toggleWorkspaceMode,
          focusReader: () => commitWorkspace({ mode: "swimlane", activeLane: "reader" }),
          focusAdjacent: focusAdjacentWorkspaceLane,
          toggleActiveLaneFullscreen: toggleActiveWorkspaceLaneFullscreen,
          fitLanes: fitWorkspaceLanes,
        },
        openFile: () => choose("file"),
        closeFile: closeSession,
        deleteCurrentFile: client.executeFileOperations ? requestDeleteCurrentFile : undefined,
        openSettings: () => setSettingsOpen(true),
        openRadialMenu,
        video: videoController,
        viewerToggles,
        switchToast,
        infoOverlay,
        hoverScroll: {
          getSnapshot: () => ({ enabled: viewDefaultsRef.current.hoverScrollEnabled ?? true }),
          update: ({ enabled }) => persistViewDefaults({ hoverScrollEnabled: enabled }),
        },
        cursorAutoHide: createReaderCursorAutoHideActionPort(() => viewDefaultsRef.current, persistViewDefaults),
        slideshow: {
          toggle: () => slideshow.toggle(),
          stop: () => slideshow.stop(),
          skip: async () => { await navigate("next", true); slideshow.resetOnUserAction() },
        },
      }, context)
    }

  function applyInputPresentation(next: ReaderPresentation): void {
      temporaryFitPresentationRef.current = undefined
      presentationTouchedRef.current = true
      setPresentation(next)
    }

  async function switchAdjacentBook(
    direction: "next" | "previous",
    { manageBusy = true }: { manageBusy?: boolean } = {},
  ): Promise<boolean> {
      const sessionId = sessionRef.current
      const openAdjacentBook = clientRef.current.openAdjacentBook
      // Prefer refs over React `busy` state so concurrent key handlers from the
      // same render cannot both enter the adjacent-book path.
      if (!sessionId || !openAdjacentBook || busy || adjacentBookPendingRef.current) return false
      slideshow.stop()
      operationRef.current?.abort()
      const controller = new AbortController()
      operationRef.current = controller
      navigationPendingRef.current = true
      adjacentBookPendingRef.current = true
      if (manageBusy) setBusy(true)
      setError(undefined)
      try {
        const replacement = await openAdjacentBook(sessionId, direction, controller.signal, adjacentBookSortRef.current)
        if (!replacement || controller.signal.aborted) return false
        sessionRef.current = replacement.sessionId
        const identity = replacement.activationIdentity
        setSlideshowFadeFrame(undefined)
        setSession(replacement)
        setPresentation({ ...DEFAULT_READER_PRESENTATION, ...viewDefaultsRef.current })
        presentationTouchedRef.current = false
        setPath(identity.readerSourcePath)
        activeSourcePathRef.current = identity.readerSourcePath
        setBrowserOriginPath(identity.traversalRootPath)
        commitOpenedSession(replacement)
        // Book-switch toast is owned by ReaderSwitchToastRuntime via book.id change.
        return true
      } catch (cause) {
        if (!controller.signal.aborted) setError(errorMessage(cause))
        return false
      } finally {
        if (operationRef.current === controller) operationRef.current = undefined
        navigationPendingRef.current = false
        adjacentBookPendingRef.current = false
        if (manageBusy && !controller.signal.aborted) setBusy(false)
      }
    }

  function toggleTemporaryFit(): void {
      const previous = temporaryFitPresentationRef.current
      if (previous) {
        temporaryFitPresentationRef.current = undefined
        presentationTouchedRef.current = true
        setPresentation(previous)
        return
      }
      temporaryFitPresentationRef.current = presentation
      presentationTouchedRef.current = true
      setPresentation({ ...presentation, fitMode: "fit", manualScale: 1 })
    }

  function toggleSinglePanorama(): void {
      const current = session?.frame.layout
      if (!current) return
      void updateSessionLayout({ panorama: !current.panorama })
    }

  function syncPanoramaVisiblePage(pageIndex: number): void {
      setSession((current) => {
        if (!current || !current.frame.layout.panorama || current.frame.anchorPageIndex === pageIndex) return current
        const bounded = Math.max(0, Math.min(current.book.pageCount - 1, pageIndex))
        return { ...current, frame: { ...current.frame, anchorPageIndex: bounded, atStart: bounded === 0, atEnd: bounded >= current.book.pageCount - 1 } }
      })
    }

  async function toggleFullscreen(): Promise<void> {
      const element = surface.ref.current
      if (!element) return
      if (document.fullscreenElement) await document.exitFullscreen?.()
      else await element.requestFullscreen?.()
    }

  function toggleShellEdge(edge: "left" | "right"): void {
      const current = shellControlStore.getSnapshot().edges[edge]
      setShellEdgePinned(edge, !current.open)
    }

  function toggleShellPin(edge: "top" | "bottom"): void {
      const current = shellControlStore.getSnapshot().edges[edge]
      setShellEdgePinned(edge, !current.pinned)
    }

  function toggleSidebarControl(): void {
      const current = shellControlStore.getSnapshot().floating
      setShellFloatingControl({ enabled: !current.enabled })
    }

  function openRadialMenu(): void {
      if (!radialMenu.enabled || !radialMenu.menus.length) return
      const point = lastInputPointRef.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      setRadialMenuRequest((current) => ({ id: (current?.id ?? 0) + 1, ...point }))
    }

  return {
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
  }
}
