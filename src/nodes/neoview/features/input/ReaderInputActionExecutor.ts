import {
  DEFAULT_READER_PRESENTATION,
  rotateReaderPresentation,
  stepReaderManualScale,
  type ReaderInputAction,
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
  openFile(): void | Promise<unknown>
  closeFile(): void | Promise<unknown>
  deleteCurrentFile?(): void | Promise<unknown>
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

export function executeReaderInputAction(action: ReaderInputAction, controls: ReaderInputActionControls): boolean {
  action = remapVideoSeekAction(action, controls.video)
  const session = controls.session()
  const presentation = controls.presentation()
  switch (action) {
    case "reader.previous-page": void controls.navigate("previous"); return true
    case "reader.next-page": void controls.navigate("next"); return true
    case "reader.first-page": if (session) void controls.goTo(0); return Boolean(session)
    case "reader.last-page": if (session) void controls.goTo(Math.max(0, session.pageCount - 1)); return Boolean(session)
    case "reader.page-left": if (session) void controls.navigate(session.direction === "right-to-left" ? "next" : "previous"); return Boolean(session)
    case "reader.page-right": if (session) void controls.navigate(session.direction === "right-to-left" ? "previous" : "next"); return Boolean(session)
    case "reader.next-book": if (session && controls.switchBook) void controls.switchBook("next"); return Boolean(session && controls.switchBook)
    case "reader.previous-book": if (session && controls.switchBook) void controls.switchBook("previous"); return Boolean(session && controls.switchBook)
    case "reader.zoom-in": controls.setPresentation({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, 1) }); return true
    case "reader.zoom-out": controls.setPresentation({ ...presentation, manualScale: stepReaderManualScale(presentation.manualScale, -1) }); return true
    case "reader.fit-window": controls.setPresentation({ ...presentation, fitMode: "fit", manualScale: 1 }); return true
    case "reader.actual-size": controls.setPresentation({ ...presentation, fitMode: "original", manualScale: 1 }); return true
    case "reader.toggle-temporary-fit": controls.toggleTemporaryFit(); return true
    case "reader.reset-view": controls.setPresentation({ ...DEFAULT_READER_PRESENTATION }); return true
    case "reader.rotate-clockwise": controls.setPresentation({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, 1) }); return true
    case "reader.rotate-180": controls.setPresentation({ ...presentation, rotation: rotateReaderPresentation(presentation.rotation, 2) }); return true
    case "reader.toggle-book-mode": if (session) void controls.updatePageMode(session.pageMode === "single" ? "double" : "single"); return Boolean(session)
    case "reader.toggle-reading-direction": if (session) void controls.updateReadingDirection(session.direction === "left-to-right" ? "right-to-left" : "left-to-right"); return Boolean(session)
    case "reader.toggle-single-panorama": controls.toggleSinglePanorama(); return true
    case "reader.fullscreen": void controls.toggleFullscreen(); return true
    case "shell.toggle-left-sidebar": controls.toggleShellEdge("left"); return true
    case "shell.toggle-right-sidebar": controls.toggleShellEdge("right"); return true
    case "shell.toggle-top-toolbar-pin": controls.toggleShellPin("top"); return true
    case "shell.toggle-bottom-thumbnail-pin": controls.toggleShellPin("bottom"); return true
    case "viewer.toggle-sidebar-control": controls.toggleSidebarControl(); return true
    case "viewer.toggle-progress-bar": controls.viewerToggles?.toggleProgressBar(); return Boolean(controls.viewerToggles)
    case "viewer.toggle-progress-bar-glow": controls.viewerToggles?.toggleProgressBarGlow(); return Boolean(controls.viewerToggles)
    case "viewer.toggle-page-info": controls.viewerToggles?.togglePageInfo(); return Boolean(controls.viewerToggles)
    case "viewer.toggle-page-switch-toast": {
      const settings = controls.switchToast?.getSnapshot()
      if (!settings || !controls.switchToast) return false
      void controls.switchToast.update({ enablePage: !settings.enablePage }).catch(() => undefined)
      return true
    }
    case "viewer.toggle-book-switch-toast": {
      const settings = controls.switchToast?.getSnapshot()
      if (!settings || !controls.switchToast) return false
      void controls.switchToast.update({ enableBook: !settings.enableBook }).catch(() => undefined)
      return true
    }
    case "viewer.toggle-boundary-toast": {
      const settings = controls.switchToast?.getSnapshot()
      if (!settings || !controls.switchToast) return false
      void controls.switchToast.update({ enableBoundaryToast: !settings.enableBoundaryToast }).catch(() => undefined)
      return true
    }
    case "viewer.toggle-info-overlay": {
      const settings = controls.infoOverlay?.getSnapshot()
      if (!settings || !controls.infoOverlay) return false
      void controls.infoOverlay.update({ enabled: !settings.enabled }).catch(() => undefined)
      return true
    }
    case "viewer.toggle-hover-scroll": {
      const settings = controls.hoverScroll?.getSnapshot()
      if (!settings || !controls.hoverScroll) return false
      void controls.hoverScroll.update({ enabled: !settings.enabled }).catch(() => undefined)
      return true
    }
    case "file.open": void controls.openFile(); return true
    case "file.close": void controls.closeFile(); return true
    case "file.delete-current":
      if (!controls.session() || !controls.deleteCurrentFile) return false
      void controls.deleteCurrentFile()
      return true
    case "reader.open-settings": controls.openSettings(); return true
    case "radial.open-default": controls.openRadialMenu(); return true
    case "radial.confirm": return true
    case "video.play-pause": return controls.video?.playPause() ?? false
    case "video.seek-forward": return controls.video?.seek(1) ?? false
    case "video.seek-backward": return controls.video?.seek(-1) ?? false
    case "video.toggle-mute": return controls.video?.toggleMute() ?? false
    case "video.cycle-loop-mode": return controls.video?.cycleLoopMode() ?? false
    case "video.volume-up": return controls.video?.adjustVolume(1) ?? false
    case "video.volume-down": return controls.video?.adjustVolume(-1) ?? false
    case "video.speed-up": return controls.video?.adjustSpeed(1) ?? false
    case "video.speed-down": return controls.video?.adjustSpeed(-1) ?? false
    case "video.toggle-speed": return controls.video?.toggleSpeed() ?? false
    case "video.toggle-seek-mode": return controls.video?.toggleSeekMode() ?? false
    case "slideshow.toggle":
    case "slideshow.play-pause": controls.slideshow.toggle(); return true
    case "slideshow.stop": controls.slideshow.stop(); return true
    case "slideshow.skip": void controls.slideshow.skip(); return true
    default: return false
  }
}

function remapVideoSeekAction(action: ReaderInputAction, video: ReaderVideoActionPort | undefined): ReaderInputAction {
  if (!video?.hasActiveVideo() || !video.isSeekMode()) return action
  if (action === "reader.next-page" || action === "reader.page-right") return "video.seek-forward"
  if (action === "reader.previous-page" || action === "reader.page-left") return "video.seek-backward"
  return action
}
