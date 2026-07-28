import { lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEventHandler } from "react"
import { BookOpen, ChevronRight, LoaderCircle, Pin, PinOff, X } from "lucide-react"
import {
  DEFAULT_READER_PRESENTATION,
  DEFAULT_READER_INPUT_BINDINGS,
  DEFAULT_READER_RADIAL_MENU_CONFIG,
  READER_INPUT_ACTION_LABELS,
  ReaderSlideshow,
  type ReaderPresentation,
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
import { publishFolderEntryRemoved, publishFolderEntryRestored } from "../features/panels/cards/folder/FolderNavigationEvents"
import { publishReaderLibraryMutation } from "../features/library/reader-library-mutations"
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
import { executeReaderInputAction, type ReaderCurrentFileDeleteOptions } from "../features/input/ReaderInputActionExecutor"
import { readerCurrentFileDeleteConfirmation } from "../features/input/ReaderCurrentFileDeleteConfirmation"
import {
  type ReaderDeletionCommand,
  type ReaderDeletionPreparation,
  type ReaderDeletionTransactionCoordinator,
} from "../features/files/ReaderDeletionTransactionCoordinator"
import { cloneReaderActivationIdentity, readerActivationProvenanceFromIdentity } from "./ReaderActivationIdentity"
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

export function attachReaderAppFileActions(context: any) {
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
    activationIdentityRef,
    commitOpenedSession,
    clearActivationIdentity,
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
    deletionCoordinator,
  } = context

  const switchAdjacentBook = (direction: "next" | "previous") => context.switchAdjacentBook(direction, { manageBusy: false })

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

  async function requestDeleteCurrentFile(options?: ReaderCurrentFileDeleteOptions): Promise<ReaderInputActionOutcome> {
      const sessionId = sessionRef.current
      const activationIdentity = cloneReaderActivationIdentity(activationIdentityRef.current)
      const targetPath = options?.targetPath?.trim() || activationIdentity.activatedEntryPath.trim()
      if (!targetPath || operationRef.current || !clientRef.current.executeFileOperations) return { status: "unavailable" }
      const strategy = options?.strategy ?? "trash"
      const confirmationRequired = !options?.confirmationHandled && (strategy === "trash" ? folderViewRef.current.confirmations.trash : folderViewRef.current.confirmations.permanentDelete)
      if (confirmationRequired && !contextMenu) {
        setError("当前界面无法打开删除确认框，文件未删除。")
        return { status: "unavailable" }
      }
      const activeSession = sessionId && fileMutationContainsSource(targetPath, activationIdentity.readerSourcePath)
        ? { sessionId, activationIdentity }
        : undefined
      const command: ReaderDeletionCommand = {
        trigger: options?.trigger ?? "reader-input",
        targetPath,
        strategy,
        confirmationRequired,
        ...(options?.adjacentDirection ? { adjacentDirection: options.adjacentDirection } : {}),
        ...(activeSession ? { activeSession } : {}),
      }
      const coordinator = deletionCoordinator as ReaderDeletionTransactionCoordinator
      setError(undefined)
      const outcome = await coordinator.delete(command, {
        started: () => setBusy(true),
        settled: () => setBusy(false),
        confirm: async (captured) => !captured.confirmationRequired
          || await contextMenu!.confirm(readerCurrentFileDeleteConfirmation(captured.targetPath, captured.strategy)),
        prepare: prepareDeletion,
        mutate: mutateDeletion,
        commit: commitDeletion,
        rollback: rollbackDeletion,
      })
      if (outcome.status === "failed") setError(errorMessage(outcome.error))
      return outcome
    }

  async function prepareDeletion(
    command: Readonly<ReaderDeletionCommand>,
    signal: AbortSignal,
  ): Promise<ReaderDeletionPreparation> {
      const activeSession = command.activeSession
      if (!activeSession || sessionRef.current !== activeSession.sessionId) return { releasedSession: false }
      signal.throwIfAborted()
      if (command.adjacentDirection) {
        const switched = await switchAdjacentBook(command.adjacentDirection)
        signal.throwIfAborted()
        if (switched && sessionRef.current) {
          return {
            releasedSession: true,
            replacementSessionId: sessionRef.current,
            consumedAction: command.adjacentDirection === "next" ? "reader.next-book" : "reader.previous-book",
          }
        }
      }
      slideshow.stop()
      await clientRef.current.close(activeSession.sessionId)
      signal.throwIfAborted()
      if (sessionRef.current === activeSession.sessionId) {
        sessionRef.current = undefined
        setSession(undefined)
        setSlideshowFadeFrame(undefined)
        setMagnifierEnabled(false)
      }
      return { releasedSession: true }
    }

  async function mutateDeletion(command: Readonly<ReaderDeletionCommand>, signal: AbortSignal): Promise<void> {
      const execute = clientRef.current.executeFileOperations
      if (!execute || operationRef.current) throw new Error("Reader file operation is unavailable.")
      const controller = new AbortController()
      operationRef.current = controller
      const abort = () => controller.abort()
      signal.addEventListener("abort", abort, { once: true })
      try {
        const result = await execute([{ kind: command.strategy, sourcePath: command.targetPath }], true, controller.signal)
        const failed = result.results.find((item) => item.status !== "succeeded")
        if (result.succeeded !== 1 || failed) {
          throw new Error(failed?.error ?? failed?.errorCode ?? (command.strategy === "trash" ? "移动到回收站失败" : "永久删除失败"))
        }
      } finally {
        signal.removeEventListener("abort", abort)
        if (operationRef.current === controller) operationRef.current = undefined
      }
    }

  async function commitDeletion(
    command: Readonly<ReaderDeletionCommand>,
    preparation: ReaderDeletionPreparation,
  ): Promise<void> {
        if (preparation.releasedSession && !preparation.replacementSessionId) {
          setPath("")
          activeSourcePathRef.current = ""
          clearActivationIdentity()
        }
        publishFolderEntryRemoved(folderNavigationEvents, command.targetPath)
        publishReaderLibraryMutation()
        switchToast.show({
          title: command.strategy === "trash" ? "已移到回收站" : "已永久删除",
          description: command.targetPath,
        })
    }

  async function rollbackDeletion(
    command: Readonly<ReaderDeletionCommand>,
    preparation: ReaderDeletionPreparation,
  ): Promise<void> {
      const activeSession = command.activeSession
      if (!preparation.releasedSession || !activeSession) return
      if (preparation.replacementSessionId && sessionRef.current === preparation.replacementSessionId) {
        await clientRef.current.close(preparation.replacementSessionId).catch(() => undefined)
        sessionRef.current = undefined
        setSession(undefined)
      }
      if (sessionRef.current) return
      const reopened = await clientRef.current.open(
        activeSession.activationIdentity.readerSourcePath,
        undefined,
        readerActivationProvenanceFromIdentity(activeSession.activationIdentity),
      )
      if (sessionRef.current) {
        void clientRef.current.close(reopened.sessionId).catch(() => undefined)
        return
      }
      sessionRef.current = reopened.sessionId
      setSession(reopened)
      setPath(reopened.activationIdentity.readerSourcePath)
      activeSourcePathRef.current = reopened.activationIdentity.readerSourcePath
      setBrowserOriginPath(reopened.activationIdentity.traversalRootPath)
      commitOpenedSession(reopened)
    }

  async function undoFileDeletion() {
      const undo = clientRef.current.undoLatestFileOperations
      if (!undo) throw new Error("Reader file-operation undo is unavailable.")
      const coordinator = deletionCoordinator as ReaderDeletionTransactionCoordinator
      setError(undefined)
      try {
        return await coordinator.undo({
          started: () => setBusy(true),
          settled: () => setBusy(false),
          undo: (signal) => undo(true, signal),
          commit: async (result) => {
            for (const item of result.results) {
              if (item.status === "succeeded" && (item.operation.kind === "trash" || item.operation.kind === "delete")) {
                publishFolderEntryRestored(folderNavigationEvents, item.operation.sourcePath)
              }
            }
            publishReaderLibraryMutation()
          },
        })
      } catch (cause) {
        setError(errorMessage(cause))
        throw cause
      }
    }

  const actions = {
    persistSlideshow,
    persistFolderView,
    closeSession,
    requestDeleteCurrentFile,
    undoFileDeletion,
  }
  Object.assign(context, actions)
  return actions
}
