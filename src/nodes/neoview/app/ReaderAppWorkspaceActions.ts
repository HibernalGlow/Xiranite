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

export function createReaderAppWorkspaceActions(context: any) {
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
    deleteCurrentFile,
  } = context

  const { onSwimlaneSoloLaneIdCommitted } = context

  function toggleWorkspaceMode(): void {
      const current = shellRef.current
      if (!current) return
      const workspace = currentReaderWorkspace(current)
      commitWorkspace({ mode: workspace.mode === "swimlane" ? "edges" : "swimlane" })
    }

  function focusAdjacentWorkspaceLane(direction: "previous" | "next"): void {
      const current = shellRef.current
      if (!current) return
      const workspace = currentReaderWorkspace(current)
      const order = workspace.swimlane.laneOrder
      const index = Math.max(0, order.indexOf(workspace.swimlane.activeLane))
      const offset = direction === "previous" ? -1 : 1
      const activeLane = order[(index + offset + order.length) % order.length] ?? "reader"
      commitWorkspace({ mode: "swimlane", activeLane })
    }

  function toggleActiveWorkspaceLaneFullscreen(): void {
      const current = shellRef.current
      if (!current) return
      const workspace = currentReaderWorkspace(current)
      const activeLane = workspace.swimlane.activeLane
      const currentSoloLane = workspace.swimlane.soloLaneId ?? (workspace.swimlane.readerSolo ? "reader" : undefined)
      commitWorkspace({ mode: "swimlane", activeLane, soloLaneId: currentSoloLane === activeLane ? null : activeLane })
    }

  function fitWorkspaceLanes(): void {
      const current = shellRef.current
      if (!current) return
      const workspace = currentReaderWorkspace(current)
      const viewportWidth = document.querySelector<HTMLElement>('[data-reader-swimlane-viewport="true"]')?.clientWidth ?? window.innerWidth
      commitWorkspace({ mode: "swimlane", ...fitReaderSwimlanesToViewport(viewportWidth, workspace.swimlane) })
    }

  function commitWorkspace(patch: ReaderWorkspacePatch): void {
      const current = shellRef.current
      if (!current) return
      const { sessionPatch, persistentPatch } = splitReaderWorkspacePatch(patch, currentReaderWorkspace(current))
      if (sessionPatch) commitSwimlaneSessionPatch(sessionPatch)
      if (!persistentPatch) return
      const optimistic = applyReaderWorkspacePatch(current, persistentPatch)
      // Skip pure no-ops (e.g. auto-fit re-emitting the same widths). Otherwise
      // setShell every cycle thrashs the tree into Maximum update depth exceeded.
      if (workspaceConfigEqual(current, optimistic)) return
      shellRef.current = optimistic
      setShell(optimistic)
      enqueueShellControl({ workspace: persistentPatch }, undefined, current)
    }

  function currentReaderWorkspace(current: ReaderShellConfigDto): ReaderWorkspaceConfig {
      return readerWorkspaceWithSession(current, useSwimlaneSessionStore.getState().sessions[swimlaneSessionScopeId])
    }

  function commitSwimlaneSessionPatch(patch: SwimlaneWorkspaceSessionState): void {
      patchSwimlaneSession(swimlaneSessionScopeId, patch)
      if (!Object.hasOwn(patch, "soloLaneId")) return
      const soloLaneId = patch.soloLaneId ?? null
      useReaderWorkspaceRestoreStore.getState().patchRestore({ lastSoloLaneId: soloLaneId })
      onSwimlaneSoloLaneIdCommitted?.(soloLaneId)
    }

  function applyConfirmedShell(confirmed: ReaderShellConfigDto): void {
      useReaderWorkspaceRestoreStore.getState().cacheShellSnapshot(confirmed)
      if (readerShellSnapshotsEqual(shellRef.current, confirmed)) return
      shellRef.current = confirmed
      setShell(confirmed)
    }

  function enqueueShellControl(
      patch: ReaderShellControlPatch["shellControl"],
      rollback?: ReaderShellControlSnapshot,
      workspaceBase?: ReaderShellConfigDto,
    ) {
      const generation = ++shellControlGenerationRef.current
      if (patch.workspace && shellRef.current) {
        pendingWorkspaceWritesRef.current.push({ generation, patch: patch.workspace, base: workspaceBase ?? shellRef.current })
      }
      shellControlWriteQueueRef.current = shellControlWriteQueueRef.current.then(async () => {
        const update = clientRef.current.updateShellControl
        if (!update) return
        const reconcile = (confirmed: ReaderShellConfigDto) => {
          pendingWorkspaceWritesRef.current = pendingWorkspaceWritesRef.current.filter((entry) => entry.generation !== generation)
          const displayed = pendingWorkspaceWritesRef.current.reduce(
            (current, entry) => applyReaderWorkspacePatch(current, entry.patch),
            confirmed,
          )
          useReaderWorkspaceRestoreStore.getState().cacheShellSnapshot(confirmed)
          shellRef.current = displayed
          setShell(displayed)
          if (generation === shellControlGenerationRef.current) shellControlStore.replace(shellControlSnapshot(confirmed))
        }
        try {
          let updated: ReaderShellConfigDto
          try {
            updated = await update({ expectedRevision: shellRef.current?.revision ?? 0, shellControl: patch })
          } catch (cause) {
            if (!(cause instanceof ReaderHttpError) || cause.status !== 409) throw cause
            const latest = await clientRef.current.config()
            updated = await update({ expectedRevision: latest.shell.revision ?? 0, shellControl: patch })
          }
          reconcile(updated)
        } catch (cause) {
          if (generation === shellControlGenerationRef.current && rollback) shellControlStore.replace(rollback)
          const failed = pendingWorkspaceWritesRef.current.find((entry) => entry.generation === generation)
          const latest = await clientRef.current.config().catch(() => undefined)
          if (failed || latest) reconcile(latest?.shell ?? failed!.base)
          setError(errorMessage(cause))
        }
      })
    }

  async function commitSidebarLayout(patch: ReaderSidebarLayoutPatch) {
      const previousControl = shellControlStore.getSnapshot()
      if (patch.pinned !== undefined) shellControlStore.setPinned(patch.side, patch.pinned)
      await enqueueShellMutation(async () => {
        try {
          const updated = await clientRef.current.updateSidebarLayout(patch)
          applyConfirmedShell(updated)
        } catch (cause) {
          if (patch.pinned !== undefined) shellControlStore.replace(previousControl)
          setShell((current) => current ? { ...current, sidebars: { ...current.sidebars } } : current)
          setError(errorMessage(cause))
        }
      })
    }

  async function commitCardLayout(patch: ReaderCardLayoutPatch) {
      const previous = shell
      const { cardId, ...changes } = patch
      if (previous) {
        const current = previous.cardLayout[cardId]
        if (current) {
          const next = { ...current, ...changes }
          if (changes.height === null) delete next.height
          setShell({
            ...previous,
            cardLayout: { ...previous.cardLayout, [cardId]: next },
          })
        }
      }
      await enqueueShellMutation(async () => {
        try {
          const updated = await clientRef.current.updateCardLayout(patch)
          applyConfirmedShell(updated)
        } catch (cause) {
          setShell(previous)
          setError(errorMessage(cause))
        }
      })
    }

  async function commitBoardLayout(patch: ReaderBoardLayoutPatch) {
      await enqueueShellMutation(async () => {
        const request = { ...patch, expectedRevision: shellRef.current?.revision ?? patch.expectedRevision }
        try {
        const updated = await clientRef.current.updateBoardLayout(request)
        applyConfirmedShell(updated)
      } catch (cause) {
        if (cause instanceof ReaderHttpError && cause.status === 409) {
          const latest = await refreshLatestShell()
          if (latest) {
            const updated = await clientRef.current.updateBoardLayout({ ...patch, expectedRevision: latest.revision ?? request.expectedRevision })
            applyConfirmedShell(updated)
            return
          }
        }
        setError(errorMessage(cause))
        throw cause
        }
      })
    }

  async function commitDraggedPanelLayout(nextShell: ReaderShellConfigDto, patch: ReaderBoardLayoutPatch): Promise<void> {
      const previous = shellRef.current
      shellRef.current = nextShell
      setShell(nextShell)
      await enqueueShellMutation(async () => {
        const request = { ...patch, expectedRevision: shellRef.current?.revision ?? patch.expectedRevision }
        try {
        const updated = await clientRef.current.updateBoardLayout(request)
        applyConfirmedShell(updated)
      } catch (cause) {
        if (cause instanceof ReaderHttpError && cause.status === 409) {
          const latest = await refreshLatestShell()
          if (latest) {
            const updated = await clientRef.current.updateBoardLayout({ ...patch, expectedRevision: latest.revision ?? request.expectedRevision })
            applyConfirmedShell(updated)
            return
          } else if (shellRef.current === nextShell) {
            shellRef.current = previous
            setShell(previous)
          }
        } else if (shellRef.current === nextShell) {
          shellRef.current = previous
          setShell(previous)
        }
        setError(errorMessage(cause))
        throw cause
        }
      })
    }

  async function persistImageProcessing(patch: Partial<ReaderImageProcessingConfigDto>): Promise<ReaderImageProcessingConfigDto> {
      if (!client.updateImageProcessing) throw new Error("当前 Reader 不支持图像处理配置写入")
      const updated = await client.updateImageProcessing({ imageProcessing: patch })
      setImageProcessing(updated)
      return updated
    }

  async function persistPreload(patch: Partial<ReaderRuntimeConfigDto["preload"]>): Promise<ReaderRuntimeConfigDto["preload"]> {
      if (!client.updatePreload) throw new Error("当前 Reader 不支持预读配置写入")
      const updated = await client.updatePreload({ preload: patch })
      setPreloadConfig(updated)
      return updated
    }

  function enqueueShellMutation(operation: () => Promise<void>): Promise<void> {
      const queued = shellControlWriteQueueRef.current.then(operation)
      shellControlWriteQueueRef.current = queued.then(() => undefined, () => undefined)
      return queued
    }

  async function refreshLatestShell(): Promise<ReaderShellConfigDto | undefined> {
      const latest = await clientRef.current.config().catch(() => undefined)
      if (!latest) return undefined
      applyConfirmedShell(latest.shell)
      shellControlStore.hydrate(shellControlHydration(latest.shell))
      return latest.shell
    }

  async function commitShellMaterial(material: ReaderShellMaterialPatch): Promise<ReaderShellConfigDto> {
      const update = clientRef.current.updateShellControl
      if (!update) throw new Error("Reader shell material config is read-only.")
      let resolveOperation!: (value: ReaderShellConfigDto) => void
      let rejectOperation!: (reason?: unknown) => void
      const result = new Promise<ReaderShellConfigDto>((resolve, reject) => {
        resolveOperation = resolve
        rejectOperation = reject
      })
      shellControlWriteQueueRef.current = shellControlWriteQueueRef.current.then(async () => {
        try {
          const updated = await update({
            expectedRevision: shellRef.current?.revision ?? 0,
            shellControl: { material },
          })
          applyConfirmedShell(updated)
          resolveOperation(updated)
        } catch (cause) {
          if (cause instanceof ReaderHttpError && cause.status === 409) {
            const latest = await clientRef.current.config().catch(() => undefined)
            if (latest) {
              applyConfirmedShell(latest.shell)
              shellControlStore.hydrate(shellControlHydration(latest.shell))
            }
          }
          setError(errorMessage(cause))
          rejectOperation(cause)
        }
      })
      return result
    }

  return {
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
  }
}
