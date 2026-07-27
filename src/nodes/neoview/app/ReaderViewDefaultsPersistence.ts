import { DEFAULT_READER_MOUSE_CURSOR_SETTINGS } from "@xiranite/node-neoview/ui-core"

import type { ReaderRuntimeConfigDto, ReaderViewDefaultsPatch } from "../adapters/reader-http-client"

type ReaderViewDefaults = ReaderRuntimeConfigDto["viewDefaults"]

export function mergeReaderViewDefaults(current: ReaderViewDefaults, patch: ReaderViewDefaultsPatch["viewDefaults"], fallbackBackground: NonNullable<ReaderViewDefaults["background"]>): ReaderViewDefaults {
  return {
    ...current,
    ...patch,
    ...(patch.background ? {
      background: {
        ...(current.background ?? fallbackBackground),
        ...patch.background,
        ...(patch.background.ambient ? { ambient: { ...(current.background ?? fallbackBackground).ambient, ...patch.background.ambient } } : {}),
        ...(patch.background.aurora ? { aurora: { ...(current.background ?? fallbackBackground).aurora, ...patch.background.aurora } } : {}),
        ...(patch.background.spotlight ? { spotlight: { ...(current.background ?? fallbackBackground).spotlight, ...patch.background.spotlight } } : {}),
      },
    } : {}),
    ...(patch.mouseCursor ? { mouseCursor: { ...(current.mouseCursor ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS), ...patch.mouseCursor } } : {}),
  }
}

export function createReaderCursorAutoHideActionPort(
  getViewDefaults: () => ReaderViewDefaults,
  persist: (patch: ReaderViewDefaultsPatch["viewDefaults"]) => Promise<void>,
) {
  return {
    getSnapshot: () => ({ enabled: (getViewDefaults().mouseCursor ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS).autoHide }),
    update: ({ enabled }: { enabled: boolean }) => {
      const mouseCursor = getViewDefaults().mouseCursor ?? DEFAULT_READER_MOUSE_CURSOR_SETTINGS
      return persist({ mouseCursor: { ...mouseCursor, autoHide: enabled } })
    },
  }
}
