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
  DEFAULT_READER_HISTORY_AUTO_CLEANUP,
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

export function createReaderAppSettingsActions(context: any) {
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
  } = context

  async function persistSubtitleConfig(patch: Partial<ReaderSubtitleConfigDto>): Promise<void> {
      if (!client.updateMedia) return
      const updated = await client.updateMedia({ media: { subtitle: patch } })
      setMedia(updated)
      videoController.configure(updated)
    }

  async function persistVideoControlsPinned(videoControlsPinned: boolean): Promise<void> {
      if (!client.updateMedia) return
      const updated = await client.updateMedia({ media: { videoControlsPinned } })
      setMedia(updated)
      videoController.configure(updated)
    }

  async function persistAnimatedVideoMode(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto> {
      if (!client.updateMedia) return media ?? {
        supportedImageFormats: [],
        videoFormats: [],
        mediaMimeTypes: {},
        autoPlayAnimatedImages: true,
        animatedVideoEnabled: false,
        animatedVideoKeywords: ["[#dyna]"],
        videoControlsPinned: false,
        videoMinPlaybackRate: 0.25,
        videoMaxPlaybackRate: 16,
        videoPlaybackRateStep: 0.25,
        subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
      }
      const updated = await client.updateMedia({ media: patch })
      setMedia(updated)
      videoController.configure(updated)
      return updated
    }

  async function explorerContextMenuPreview() {
      return clientRef.current.explorerContextMenuPreview?.()
        ?? { available: false, plan: [], registryFile: "", reason: "当前 Reader 后端不支持资源管理器集成。" }
    }

  async function explorerContextMenuStatus() {
      return clientRef.current.explorerContextMenuStatus?.()
        ?? { available: false, enabled: false, state: "unavailable" as const, reason: "当前 Reader 后端不支持资源管理器集成。" }
    }

  async function setExplorerContextMenuEnabled(enabled: boolean) {
      if (!clientRef.current.setExplorerContextMenuEnabled) throw new Error("当前 Reader 后端不支持资源管理器集成。")
      return clientRef.current.setExplorerContextMenuEnabled(enabled, true)
    }

  async function repairExplorerContextMenu() {
      if (!clientRef.current.repairExplorerContextMenu) throw new Error("当前 Reader 后端不支持资源管理器集成。")
      return clientRef.current.repairExplorerContextMenu(true)
    }

  async function persistSuperResolutionConfig(patch: Parameters<NonNullable<ReaderHttpClient["updateSuperResolution"]>>[0]["superResolution"]) {
      if (!client.updateSuperResolution) throw new Error("当前 Reader 不支持超分配置写入")
      const updated = await client.updateSuperResolution({ superResolution: patch })
      setSuperResolution(updated)
      return updated
    }

  function persistSuperResolution(patch: NonNullable<ReaderRuntimeConfigDto["superResolution"]>["preferences"]) {
      return persistSuperResolutionConfig({ preferences: patch })
    }

  async function runPreloadAction(action: "cancel-speculative" | "release-retained", signal?: AbortSignal) {
      const activeSession = session
      if (!activeSession || !client.runPreloadAction) throw new Error("当前后端不支持预加载控制")
      const result = await client.runPreloadAction(activeSession.sessionId, action, signal)
      if (sessionRef.current !== activeSession.sessionId) throw new Error("Reader 会话已切换")
      if (action === "cancel-speculative") {
        prefetchController.cancel()
        setCancelledPreloadFrame({ sessionId: activeSession.sessionId, generation: activeSession.frame.generation })
      } else {
        prefetchController.releaseRetained(new Set(activeSession.visiblePages.map((page) => page.assetUrl)))
      }
      return result
    }

  async function updateNavigation(
      request: (sessionId: string, signal: AbortSignal) => Promise<ReaderNavigationDto>,
      slideshowAction = false, presentEachPage = false,
    ): Promise<boolean> {
      const sessionId = sessionRef.current
      if (!sessionId || busy || navigationPendingRef.current) return false
      const controller = new AbortController()
      operationRef.current?.abort()
      operationRef.current = controller
      navigationPendingRef.current = true
      setError(undefined)
      try {
        const result = await request(sessionId, controller.signal)
        if (!controller.signal.aborted) {
          setSlideshowFadeFrame(slideshowAction && slideshowConfigRef.current.fadeTransition
            ? `${sessionId}:${result.frame.generation}`
            : undefined)
          await commitReaderNavigation(() => setSession((current) => current ? applyNavigation(current, result) : current), pageTransition.getSnapshot(), presentEachPage)
        }
        return !controller.signal.aborted
      } catch (cause) {
        if (!controller.signal.aborted) setError(errorMessage(cause))
        return false
      } finally {
        if (operationRef.current === controller) {
          operationRef.current = undefined
          navigationPendingRef.current = false
        }
      }
    }

  function applyBookSettingsUpdate(sessionId: string, update: ReaderBookSettingsUpdateDto) {
      if (sessionRef.current !== sessionId) return
      setSession((current) => current?.sessionId === sessionId ? applyNavigation(current, update) : current)
    }

  function updatePresentation(next: ReaderPresentation) {
      const defaultsPatch: ReaderViewDefaultsPatch["viewDefaults"] = {}
      if (next.fitMode !== presentation.fitMode) defaultsPatch.fitMode = next.fitMode
      if (next.orientation !== presentation.orientation) defaultsPatch.orientation = next.orientation
      if (next.autoRotation !== presentation.autoRotation) defaultsPatch.autoRotation = next.autoRotation
      if (next.widePageStretch !== presentation.widePageStretch) defaultsPatch.widePageStretch = next.widePageStretch
      presentationTouchedRef.current = true
      setPresentation(next)
      if (Object.keys(defaultsPatch).length) void persistViewDefaults(defaultsPatch)
    }

  async function updatePageMode(pageMode: "single" | "double") {
      if (pageMode === session?.frame.layout.pageMode) return
      const updated = await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
        sessionId,
        { layout: { pageMode } },
        signal,
      ))
      if (updated) void persistViewDefaults({ pageMode })
    }

  async function updateSessionLayout(layout: Partial<NonNullable<typeof session>["frame"]["layout"]>) {
      const current = session?.frame.layout
      if (!current || Object.entries(layout).every(([key, value]) => current[key as keyof typeof current] === value)) return
      const updated = await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
        sessionId,
        { layout },
        signal,
      ))
      if (updated && layout.pageMode) void persistViewDefaults({ pageMode: layout.pageMode })
      if (updated && layout.splitWidePages !== undefined) void persistViewDefaults({ splitWidePages: layout.splitWidePages })
    }

  async function updateReadingDirection(direction: "left-to-right" | "right-to-left") {
      if (direction === session?.frame.direction) return
      await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(sessionId, { direction }, signal))
    }

  async function updateReadingDirectionLock(direction: "left-to-right" | "right-to-left" | null) {
      if (!clientRef.current.updateBookDefaults) throw new Error("当前 Reader 不支持阅读方向锁定")
      setError(undefined)
      try {
        const updated = await clientRef.current.updateBookDefaults({
          book: { ...bookDefaults, lockedReadingDirection: direction },
        })
        setBookDefaults(updated)
      } catch (cause) {
        setError(errorMessage(cause))
      }
    }

  async function updateCurrentPageOrder(patch: Partial<ReaderPageOrderDto>) {
      if (!clientRef.current.updatePageOrder) throw new Error("当前 Reader 不支持页面排序")
      await updateNavigation((sessionId, signal) => clientRef.current.updatePageOrder!(sessionId, patch, signal))
    }

  async function updatePageOrderLocks(next: ReaderBookDefaultsDto) {
      if (!clientRef.current.updateBookDefaults) throw new Error("当前 Reader 不支持排序锁定")
      setError(undefined)
      try {
        const updated = await clientRef.current.updateBookDefaults({ book: next })
        setBookDefaults(updated)
      } catch (cause) {
        setError(errorMessage(cause))
      }
    }

  async function updateCurrentBookPageMode(pageMode: "single" | "double") {
      if (pageMode === session?.frame.layout.pageMode) return
      await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
        sessionId,
        { layout: { pageMode } },
        signal,
      ))
    }

  async function updateCurrentBookReadingDirection(direction: "left-to-right" | "right-to-left") {
      if (direction === session?.frame.direction) return
      await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
        sessionId,
        { direction },
        signal,
      ))
    }

  async function persistHistoryListPreferences(patch: ReaderHistoryListPreferencesPatch["historyList"]): Promise<ReaderHistoryListPreferencesDto> {
      const generation = ++historyListPreferencesGenerationRef.current
      const next = {
        ...historyListPreferences,
        ...patch,
        autoCleanup: patch.autoCleanup
          ? { ...(historyListPreferences.autoCleanup ?? DEFAULT_READER_HISTORY_AUTO_CLEANUP), ...patch.autoCleanup }
          : historyListPreferences.autoCleanup,
        viewOverrides: patch.viewOverrides
          ? applyReaderFilePresentationOverridePatch(historyListPreferences.viewOverrides, patch.viewOverrides)
          : historyListPreferences.viewOverrides,
      }
      if (!clientRef.current.updateHistoryList) {
        setHistoryListPreferences(next)
        return next
      }
      const updated = await clientRef.current.updateHistoryList({ historyList: patch })
      if (generation === historyListPreferencesGenerationRef.current) setHistoryListPreferences(updated)
      return updated
    }

  async function persistBookmarkListPreferences(patch: ReaderBookmarkListPreferencesPatch["bookmarkList"]): Promise<ReaderBookmarkListPreferencesDto> {
      const generation = ++bookmarkListPreferencesGenerationRef.current
      const next = {
        ...bookmarkListPreferences,
        ...patch,
        viewOverrides: patch.viewOverrides
          ? applyReaderFilePresentationOverridePatch(bookmarkListPreferences.viewOverrides, patch.viewOverrides)
          : bookmarkListPreferences.viewOverrides,
      }
      if (!clientRef.current.updateBookmarkList) {
        setBookmarkListPreferences(next)
        return next
      }
      const updated = await clientRef.current.updateBookmarkList({ bookmarkList: patch })
      if (generation === bookmarkListPreferencesGenerationRef.current) setBookmarkListPreferences(updated)
      return updated
    }

  async function persistPageListPreferences(patch: Partial<ReaderPageListPreferencesDto>) {
      const next = { ...pageListPreferencesRef.current, ...patch }
      pageListPreferencesRef.current = next
      setPageListPreferences(next)
      if (!clientRef.current.updatePageList) {
        confirmedPageListPreferencesRef.current = next
        return
      }
      const generation = ++pageListPreferencesGenerationRef.current
      const write = pageListPreferencesWriteQueueRef.current.then(async () => {
        try {
          const updated = await clientRef.current.updatePageList!({ pageList: patch })
          confirmedPageListPreferencesRef.current = updated
          if (generation === pageListPreferencesGenerationRef.current) {
            pageListPreferencesRef.current = updated
            setPageListPreferences(updated)
          }
        } catch (cause) {
          if (generation === pageListPreferencesGenerationRef.current) {
            const confirmed = confirmedPageListPreferencesRef.current
            pageListPreferencesRef.current = confirmed
            setPageListPreferences(confirmed)
          }
          throw cause
        }
      })
      pageListPreferencesWriteQueueRef.current = write.catch(() => undefined)
      await write
    }

  async function persistViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
      const current = viewDefaultsRef.current
      const next = mergeReaderViewDefaults(current, patch, INITIAL_VIEW_DEFAULTS.background)
      viewDefaultsRef.current = next
      setViewDefaults(next)
      const generation = ++viewDefaultsGenerationRef.current
      const write = viewDefaultsWriteQueueRef.current.then(async () => {
        try {
          const updated = await clientRef.current.updateViewDefaults({ viewDefaults: patch })
          confirmedViewDefaultsRef.current = updated
          if (generation === viewDefaultsGenerationRef.current) {
            viewDefaultsRef.current = updated
            setViewDefaults(updated)
          }
        } catch (cause) {
          if (generation === viewDefaultsGenerationRef.current) {
            const confirmed = confirmedViewDefaultsRef.current
            viewDefaultsRef.current = confirmed
            setViewDefaults(confirmed)
          }
          setError(errorMessage(cause))
        }
      })
      viewDefaultsWriteQueueRef.current = write
      await write
    }

  async function applyConfiguredViewDefaults(patch: ReaderViewDefaultsPatch["viewDefaults"]) {
      if (!Object.keys(patch).length) return
      const presentationPatch = {
        ...(patch.fitMode ? { fitMode: patch.fitMode, manualScale: 1 } : {}),
        ...(patch.orientation ? { orientation: patch.orientation } : {}),
        ...(patch.autoRotation ? { autoRotation: patch.autoRotation } : {}),
        ...(patch.widePageStretch ? { widePageStretch: patch.widePageStretch } : {}),
      }
      if (Object.keys(presentationPatch).length) {
        presentationTouchedRef.current = true
        setPresentation((current) => ({ ...current, ...presentationPatch }))
      }
      if (patch.pageMode && sessionRef.current && patch.pageMode !== session?.frame.layout.pageMode) {
        const updated = await updateNavigation((sessionId, signal) => clientRef.current.updateSessionOptions(
          sessionId,
          { layout: { pageMode: patch.pageMode } },
          signal,
        ))
        if (!updated) return
      }
      await persistViewDefaults(patch)
    }

  async function persistInputBindings(patch: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderInputBindingsConfig> {
      if (!clientRef.current.updateInputBindings) throw new Error("当前 Reader 后端不支持操作绑定设置。")
      const updated = await clientRef.current.updateInputBindings({ inputBindings: patch })
      inputBindingsRef.current = updated
      setInputBindings(updated)
      return updated
    }

  async function persistRadialMenu(patch: ReaderRadialMenuPatch["radialMenu"], inputBindingsPatch?: ReaderInputBindingsPatch["inputBindings"]): Promise<ReaderRadialMenuConfig> {
      return await persistReaderRadialMenu(clientRef.current, patch, inputBindingsPatch, (updated) => {
        inputBindingsRef.current = updated
        setInputBindings(updated)
      }, setRadialMenu)
    }

  async function persistVoiceControl(patch: ReaderVoiceControlPatch["voiceControl"]): Promise<ReaderVoiceControlConfig> {
      if (!clientRef.current.updateVoiceControl) throw new Error("当前 Reader 后端不支持语音控制设置。")
      const updated = await clientRef.current.updateVoiceControl({ voiceControl: patch })
      setVoiceControl(updated)
      return updated
    }

  async function inspectLegacySettings(content: string, modules?: readonly string[]): Promise<ReaderSettingsMigrationInspection> {
      if (!clientRef.current.inspectLegacySettings) throw new Error("褰撳墠 Reader 鍚庣涓嶆敮鎸佹棫璁剧疆瀵煎叆銆")
      return clientRef.current.inspectLegacySettings(content, modules)
    }

  async function importLegacySettings(content: string, strategy: "merge" | "overwrite" = "merge", modules?: readonly string[]): Promise<ReaderSettingsMigrationImportResult> {
      if (!clientRef.current.importLegacySettings) throw new Error("褰撳墠 Reader 鍚庣涓嶆敮鎸佹棫璁剧疆瀵煎叆銆")
      const result = await clientRef.current.importLegacySettings(content, strategy, modules)
      const config = await clientRef.current.config()
      inputBindingsRef.current = config.inputBindings
      setInputBindings(config.inputBindings)
      setRadialMenu(config.radialMenu ?? structuredClone(DEFAULT_READER_RADIAL_MENU_CONFIG))
      setVoiceControl(config.voiceControl)
      applyConfirmedShell(config.shell)
      return result
    }

  return {
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
  }
}
