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
import { publishFolderEntryRemoved } from "../features/panels/cards/folder/FolderNavigationEvents"
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

export function createReaderAppFileActions(context: any) {
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
    activationRootPathRef,
    commitPath,
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
  } = context

  const switchAdjacentBook = (direction: "next" | "previous") => context.switchAdjacentBook(direction)

  async function persistSlideshow(patch: ReaderSlideshowPatch["slideshow"]) {
      slideshow.configure(patch)
      const normalizedPatch = patch.intervalSeconds === undefined
        ? patch
        : { ...patch, intervalSeconds: slideshow.getSnapshot().intervalSeconds }
      const next = { ...slideshowConfigRef.current, ...normalizedPatch }
      slideshowConfigRef.current = next
      setSlideshowConfig(next)
      const generation = ++slideshowGenerationRef.current
      const write = slideshowWriteQueueRef.current.then(async () => {
        try {
          const updated = await clientRef.current.updateSlideshow({ slideshow: normalizedPatch })
          confirmedSlideshowConfigRef.current = updated
          if (generation === slideshowGenerationRef.current) {
            slideshowConfigRef.current = updated
            setSlideshowConfig(updated)
            slideshow.configure(updated)
          }
        } catch (cause) {
          if (generation === slideshowGenerationRef.current) {
            const confirmed = confirmedSlideshowConfigRef.current
            slideshowConfigRef.current = confirmed
            setSlideshowConfig(confirmed)
            slideshow.configure(confirmed)
          }
          setError(errorMessage(cause))
        }
      })
      slideshowWriteQueueRef.current = write
      await write
    }

  async function persistFolderView(patch: ReaderFolderViewPatch["folderView"]) {
      const next = mergeReaderFolderViewPatch(folderViewRef.current, patch, INITIAL_FOLDER_VIEW_CONFIG)
      folderViewRef.current = next
      setFolderView(next)
      if (!clientRef.current.updateFolderView) {
        confirmedFolderViewRef.current = next
        return
      }
      const generation = ++folderViewGenerationRef.current
      const write = folderViewWriteQueueRef.current.then(async () => {
        try {
          const updated = await clientRef.current.updateFolderView!({ folderView: patch })
          confirmedFolderViewRef.current = updated
          if (generation === folderViewGenerationRef.current) {
            folderViewRef.current = updated
            setFolderView(updated)
          }
        } catch (cause) {
          if (generation === folderViewGenerationRef.current) {
            const confirmed = confirmedFolderViewRef.current
            folderViewRef.current = confirmed
            setFolderView(confirmed)
          }
          setError(errorMessage(cause))
        }
      })
      folderViewWriteQueueRef.current = write
      await write
    }

  async function closeSession() {
      slideshow.stop()
      operationRef.current?.abort()
      operationRef.current = undefined
      const sessionId = sessionRef.current
      sessionRef.current = undefined
      setSession(undefined)
      setSlideshowFadeFrame(undefined)
      setMagnifierEnabled(false)
      setBusy(false)
      if (sessionId) await clientRef.current.close(sessionId).catch(() => undefined)
    }

  async function prepareFileMutation(targetPath: string, signal?: AbortSignal): Promise<import("../features/panels/registry").ReaderFileMutationPreparation | undefined> {
      signal?.throwIfAborted()
      const sessionId = sessionRef.current
      const sourcePath = activeSourcePathRef.current.trim()
      const activationRootPath = activationRootPathRef.current
      if (!sessionId || !sourcePath || !fileMutationContainsSource(targetPath, sourcePath)) return undefined
  
      slideshow.stop()
      await clientRef.current.close(sessionId)
      if (sessionRef.current !== sessionId) return undefined
  
      sessionRef.current = undefined
      setSession(undefined)
      setSlideshowFadeFrame(undefined)
      setMagnifierEnabled(false)
      let settled = false
      return {
        commit: () => {
          if (settled || sessionRef.current) return
          settled = true
          activeSourcePathRef.current = ""
          activationRootPathRef.current = ""
          setPath("")
          commitPath("", browserOriginPath)
        },
        restore: async () => {
          if (settled || sessionRef.current) return
          settled = true
          const reopened = await clientRef.current.open(sourcePath)
          if (sessionRef.current) {
            void clientRef.current.close(reopened.sessionId).catch(() => undefined)
            return
          }
          sessionRef.current = reopened.sessionId
          activeSourcePathRef.current = sourcePath
          activationRootPathRef.current = activationRootPath
          setPath(sourcePath)
          setSession(reopened)
          commitPath(sourcePath, browserOriginPath)
        },
      }
    }

  async function requestDeleteCurrentFile(adjacentDirection?: "next" | "previous"): Promise<ReaderInputActionOutcome> {
      const sessionId = sessionRef.current
      const readerSourcePath = activeSourcePathRef.current.trim()
      const activationRootPath = activationRootPathRef.current.trim()
      if (!sessionId || !readerSourcePath || !activationRootPath || operationRef.current || !clientRef.current.executeFileOperations) return { status: "unavailable" }
      const confirmTrash = folderViewRef.current.confirmations.trash
      if (confirmTrash && !contextMenu) {
        setError("当前界面无法打开删除确认框，文件未删除。")
        return { status: "unavailable" }
      }
      const confirmed = !confirmTrash || await contextMenu!.confirm(readerCurrentFileDeleteConfirmation(activationRootPath))
      if (!confirmed) return { status: "cancelled" }
      const switched = adjacentDirection ? await switchAdjacentBook(adjacentDirection) : false
      const consumedAction = switched ? adjacentDirection === "next" ? "reader.next-book" : "reader.previous-book" : undefined
      return deleteCurrentFile(sessionId, activationRootPath, readerSourcePath, consumedAction, switched ? sessionRef.current : undefined)
    }

  async function deleteCurrentFile(
    sessionId: string,
    targetPath: string,
    readerSourcePath: string,
    consumedAction?: ReaderInputAction,
    replacementSessionId?: string,
  ): Promise<ReaderInputActionOutcome> {
      const execute = clientRef.current.executeFileOperations
      if (!execute || sessionRef.current !== (replacementSessionId ?? sessionId) || operationRef.current) return { status: "unavailable" }
      slideshow.stop()
      const controller = new AbortController()
      operationRef.current = controller
      setBusy(true)
      setError(undefined)
      let released = Boolean(replacementSessionId)
      try {
        if (!replacementSessionId) {
          await clientRef.current.close(sessionId)
          released = true
          controller.signal.throwIfAborted()
          if (sessionRef.current !== sessionId) return { status: "cancelled" }
          sessionRef.current = undefined
          setSession(undefined)
          setSlideshowFadeFrame(undefined)
          setMagnifierEnabled(false)
        }
        const result = await execute([{ kind: "trash", sourcePath: targetPath }], true, controller.signal)
        const failed = result.results.find((item) => item.status !== "succeeded")
        if (result.succeeded !== 1 || failed) {
          throw new Error(failed?.error ?? failed?.errorCode ?? "移动到回收站失败")
        }
        if (!replacementSessionId) {
          setPath("")
          activeSourcePathRef.current = ""
          activationRootPathRef.current = ""
          commitPath("", browserOriginPath)
        }
        publishFolderEntryRemoved(folderNavigationEvents, targetPath)
        switchToast.show({ title: "已移到回收站", description: targetPath })
        return { status: "succeeded", ...(consumedAction ? { consumedAction } : {}) }
      } catch (cause) {
        if (controller.signal.aborted) return { status: "cancelled" }
        if (released) {
          try {
            if (replacementSessionId && sessionRef.current === replacementSessionId) {
              await clientRef.current.close(replacementSessionId)
              sessionRef.current = undefined
              setSession(undefined)
            }
            if (sessionRef.current) throw new Error("Reader session changed during delete recovery.")
            const reopened = await clientRef.current.open(readerSourcePath, controller.signal)
            sessionRef.current = reopened.sessionId
            setSession(reopened)
            setPath(readerSourcePath)
            activeSourcePathRef.current = readerSourcePath
            activationRootPathRef.current = targetPath
            commitPath(readerSourcePath, browserOriginPath)
          } catch {
            // Preserve the original operation error; reopening is best-effort recovery.
          }
        }
        setError(errorMessage(cause))
        return { status: "failed", error: cause }
      } finally {
        if (operationRef.current === controller) operationRef.current = undefined
        if (!controller.signal.aborted) setBusy(false)
      }
    }

  return {
    persistSlideshow,
    persistFolderView,
    closeSession,
    prepareFileMutation,
    requestDeleteCurrentFile,
    deleteCurrentFile,
  }
}
