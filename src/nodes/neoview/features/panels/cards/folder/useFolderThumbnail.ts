import { useCallback, useSyncExternalStore } from "react"

import type { FolderThumbnailEntrySnapshot, FolderThumbnailStore } from "./FolderThumbnailStore"

export function useFolderThumbnail(store: FolderThumbnailStore | undefined, path?: string) {
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(path, listener) ?? (() => undefined),
    [path, store],
  )
  const getSnapshot = useCallback(() => store?.entry(path) ?? EMPTY_THUMBNAIL, [path, store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const EMPTY_THUMBNAIL: FolderThumbnailEntrySnapshot = Object.freeze({})
