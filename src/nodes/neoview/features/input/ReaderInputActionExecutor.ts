import {
  DEFAULT_READER_PRESENTATION,
  rotateReaderPresentation,
  stepReaderManualScale,
  type ReaderInputAction,
  type ReaderInputActionExecutionContext,
  type ReaderInputActionOutcome,
  type ReaderPresentation,
} from "@xiranite/node-neoview/ui-core"
import type { ReaderVideoActionPort } from "../video/ReaderVideoController"
import type { ReaderViewerTogglePort } from "../viewer/ReaderViewerToggleStore"

interface ReaderSwitchToastActionPort {
  getSnapshot(): { enableBook: boolean; enablePage: boolean; enableBoundaryToast: boolean }
  update(patch: { enableBook?: boolean; enablePage?: boolean; enableBoundaryToast?: boolean }): Promise<void>
}

interface ReaderInfoOverlayActionPort {
  getSnapshot(): { enabled: boolean } | undefined
  update(patch: { enabled?: boolean }): Promise<void>
}

interface ReaderHoverScrollActionPort {
  getSnapshot(): { enabled: boolean }
  update(patch: { enabled: boolean }): Promise<void>
}

export interface ReaderInputActionSession {
  pageCount: number
  pageIndex: number
  direction: "left-to-right" | "right-to-left"
  pageMode: "single" | "double"
}

export interface ReaderInputActionControls {
  session(): ReaderInputActionSession | undefined
  presentation(): ReaderPresentation
  setPresentation(next: ReaderPresentation): void
  navigate(direction: "next" | "previous", slideshowAction?: boolean): void | Promise<unknown>
  goTo(pageIndex: number, slideshowAction?: boolean): void | Promise<unknown>
  switchBook?(direction: "next" | "previous"): void | Promise<unknown>
  updatePageMode(pageMode: "single" | "double"): void | Promise<unknown>
  updateReadingDirection(direction: "left-to-right" | "right-to-left"): void | Promise<unknown>
  toggleTemporaryFit(): void
  toggleSinglePanorama(): void
  toggleFullscreen(): void | Promise<unknown>
  toggleShellEdge(edge: "left" | "right"): void
  toggleShellPin(edge: "top" | "bottom"): void
  toggleSidebarControl(): void
  toggleInlineBranchExpansion?(): void | Promise<unknown>
  workspace?: {
    toggleLayoutMode(): void
    focusReader(): void
    focusAdjacent(direction: "previous" | "next"): void
    toggleActiveLaneFullscreen(): void
    fitLanes(): void
  }
  openFile(): void | Promise<unknown>
  closeFile(): void | Promise<unknown>
  deleteCurrentFile?(adjacentDirection?: "next" | "previous"): Promise<ReaderInputActionOutcome>
  openSettings(): void
  openRadialMenu(): void
  video?: ReaderVideoActionPort
  viewerToggles?: ReaderViewerTogglePort
  switchToast?: ReaderSwitchToastActionPort
  infoOverlay?: ReaderInfoOverlayActionPort
  hoverScroll?: ReaderHoverScrollActionPort
  slideshow: {
    toggle(): void
    stop(): void
    skip(): void | Promise<unknown>
  }
}

export async function executeReaderInputAction(
  action: ReaderInputAction,
  controls: ReaderInputActionControls,
  context?: ReaderInputActionExecutionContext,
): Promise<ReaderInputActionOutcome> {
  action = remapVideoSeekAction(action, controls.video)
  const session = controls.session()
  const presentation = controls.presentation()
  switch (action) {
    case "reader.previous-page": return outcomeOf(controls.navigate("previous"))
    case "reader.next-page": return outcomeOf(controls.navigate("next"))
    case "reader.first-page": return session ? outcomeOf(controls.goTo(0)) : UNAVAILABLE
    case "reader.last-page": return session ? outcomeOf(controls.goTo(Math.max(0, session.pageCount - 1))) : UNAVAILABLE
    case "reader.page-left": return session ? outcomeOf(controls.navigate(session.direction === "right-to-left" ? "next" : "previous")) : UNAVAILABLE
    case "reader.page-right": return session ? outcomeOf(controls.navigate(session.direction === "right-to-left" ? "previous" : "next")) : UNAVAILABLE
    case "reader.next-book":
      if (context?.previousOutcome?.status === "succeeded" && context.previousOutcome.consumedAction === action) return SUCCEEDED
      return session && controls.switchBook ? outcomeOf(controls.switchBook("next")) : UNAVAILABLE
    case "reader.previous-book":
      if (context?.previousOutcome?.status === "succeeded" && context.previousOutcome.consumedAction === action) return SUCCEEDED
      return session && controls.switchBook ? outcomeOf(controls.switchBook("previous")) : UNAVAILABLE
    case "reader.zoom-in": controls.setPresentation({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, 1) }); return SUCCEEDED
    case "reader.zoom-out": controls.setPresentation({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, -1) }); return SUCCEEDED
    case "reader.fit-window": controls.setPresentation({ ...presentation, fitMode: "fit", manualScale: 1 }); return SUCCEEDED
    case "reader.actual-size": controls.setPresentation({ ...presentation, fitMode: "original", manualScale: 1 }); return SUCCEEDED
    case "reader.toggle-temporary-fit": controls.toggleTemporaryFit(); return SUCCEEDED
    case "reader.reset-view": controls.setPresentation({ ...DEFAULT_READER_PRESENTATION }); return SUCCEEDED
    case "reader.rotate-clockwise": controls.setPresentation({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, 1) }); return SUCCEEDED
    case "reader.rotate-180": controls.setPresentation({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, 2) }); return SUCCEEDED
    case "reader.toggle-book-mode": return session ? outcomeOf(controls.updatePageMode(session.pageMode === "single" ? "double" : "single")) : UNAVAILABLE
    case "reader.toggle-reading-direction": return session ? outcomeOf(controls.updateReadingDirection(session.direction === "left-to-right" ? "right-to-left" : "left-to-right")) : UNAVAILABLE
    case "reader.toggle-single-panorama": controls.toggleSinglePanorama(); return SUCCEEDED
    case "reader.fullscreen": return outcomeOf(controls.toggleFullscreen())
    case "workspace.toggle-layout-mode": controls.workspace?.toggleLayoutMode(); return controls.workspace ? SUCCEEDED : UNAVAILABLE
    case "workspace.focus-reader": controls.workspace?.focusReader(); return controls.workspace ? SUCCEEDED : UNAVAILABLE
    case "workspace.focus-previous-lane": controls.workspace?.focusAdjacent("previous"); return controls.workspace ? SUCCEEDED : UNAVAILABLE
    case "workspace.focus-next-lane": controls.workspace?.focusAdjacent("next"); return controls.workspace ? SUCCEEDED : UNAVAILABLE
    case "workspace.toggle-active-lane-fullscreen": controls.workspace?.toggleActiveLaneFullscreen(); return controls.workspace ? SUCCEEDED : UNAVAILABLE
    case "workspace.fit-lanes": controls.workspace?.fitLanes(); return controls.workspace ? SUCCEEDED : UNAVAILABLE
    case "shell.toggle-left-sidebar": controls.toggleShellEdge("left"); return SUCCEEDED
    case "shell.toggle-right-sidebar": controls.toggleShellEdge("right"); return SUCCEEDED
    case "shell.toggle-top-toolbar-pin": controls.toggleShellPin("top"); return SUCCEEDED
    case "shell.toggle-bottom-thumbnail-pin": controls.toggleShellPin("bottom"); return SUCCEEDED
    case "viewer.toggle-sidebar-control": controls.toggleSidebarControl(); return SUCCEEDED
    case "folder.toggle-inline-branch-expansion": return controls.toggleInlineBranchExpansion ? outcomeOf(controls.toggleInlineBranchExpansion()) : UNAVAILABLE
    case "viewer.toggle-progress-bar": controls.viewerToggles?.toggleProgressBar(); return controls.viewerToggles ? SUCCEEDED : UNAVAILABLE
    case "viewer.toggle-progress-bar-glow": controls.viewerToggles?.toggleProgressBarGlow(); return controls.viewerToggles ? SUCCEEDED : UNAVAILABLE
    case "viewer.toggle-page-info": controls.viewerToggles?.togglePageInfo(); return controls.viewerToggles ? SUCCEEDED : UNAVAILABLE
    case "viewer.toggle-page-switch-toast": {
      const settings = controls.switchToast?.getSnapshot()
      if (!settings || !controls.switchToast) return UNAVAILABLE
      return outcomeOf(controls.switchToast.update({ enablePage: !settings.enablePage }))
    }
    case "viewer.toggle-book-switch-toast": {
      const settings = controls.switchToast?.getSnapshot()
      if (!settings || !controls.switchToast) return UNAVAILABLE
      return outcomeOf(controls.switchToast.update({ enableBook: !settings.enableBook }))
    }
    case "viewer.toggle-boundary-toast": {
      const settings = controls.switchToast?.getSnapshot()
      if (!settings || !controls.switchToast) return UNAVAILABLE
      return outcomeOf(controls.switchToast.update({ enableBoundaryToast: !settings.enableBoundaryToast }))
    }
    case "viewer.toggle-info-overlay": {
      const settings = controls.infoOverlay?.getSnapshot()
      if (!settings || !controls.infoOverlay) return UNAVAILABLE
      return outcomeOf(controls.infoOverlay.update({ enabled: !settings.enabled }))
    }
    case "viewer.toggle-hover-scroll": {
      const settings = controls.hoverScroll?.getSnapshot()
      if (!settings || !controls.hoverScroll) return UNAVAILABLE
      return outcomeOf(controls.hoverScroll.update({ enabled: !settings.enabled }))
    }
    case "file.open": return outcomeOf(controls.openFile())
    case "file.close": return outcomeOf(controls.closeFile())
    case "file.delete-current":
      if (!controls.session() || !controls.deleteCurrentFile) return UNAVAILABLE
      return controls.deleteCurrentFile(context?.nextAction === "reader.next-book" ? "next" : context?.nextAction === "reader.previous-book" ? "previous" : undefined)
    case "reader.open-settings": controls.openSettings(); return SUCCEEDED
    case "radial.open-default": controls.openRadialMenu(); return SUCCEEDED
    case "radial.confirm": return SUCCEEDED
    case "video.play-pause": return booleanOutcome(controls.video?.playPause())
    case "video.seek-forward": return booleanOutcome(controls.video?.seek(1))
    case "video.seek-backward": return booleanOutcome(controls.video?.seek(-1))
    case "video.toggle-mute": return booleanOutcome(controls.video?.toggleMute())
    case "video.cycle-loop-mode": return booleanOutcome(controls.video?.cycleLoopMode())
    case "video.volume-up": return booleanOutcome(controls.video?.adjustVolume(1))
    case "video.volume-down": return booleanOutcome(controls.video?.adjustVolume(-1))
    case "video.speed-up": return booleanOutcome(controls.video?.adjustSpeed(1))
    case "video.speed-down": return booleanOutcome(controls.video?.adjustSpeed(-1))
    case "video.toggle-speed": return booleanOutcome(controls.video?.toggleSpeed())
    case "video.toggle-seek-mode": return booleanOutcome(controls.video?.toggleSeekMode())
    case "slideshow.toggle":
    case "slideshow.play-pause": controls.slideshow.toggle(); return SUCCEEDED
    case "slideshow.stop": controls.slideshow.stop(); return SUCCEEDED
    case "slideshow.skip": return outcomeOf(controls.slideshow.skip())
    default: return UNAVAILABLE
  }
}

const SUCCEEDED = { status: "succeeded" } as const
const UNAVAILABLE = { status: "unavailable" } as const

function booleanOutcome(value: boolean | undefined): ReaderInputActionOutcome {
  return value ? SUCCEEDED : UNAVAILABLE
}

async function outcomeOf(value: void | Promise<unknown>): Promise<ReaderInputActionOutcome> {
  return await value === false ? UNAVAILABLE : SUCCEEDED
}

function remapVideoSeekAction(action: ReaderInputAction, video: ReaderVideoActionPort | undefined): ReaderInputAction {
  if (!video?.hasActiveVideo() || !video.isSeekMode()) return action
  if (action === "reader.next-page" || action === "reader.page-right") return "video.seek-forward"
  if (action === "reader.previous-page" || action === "reader.page-left") return "video.seek-backward"
  return action
}
