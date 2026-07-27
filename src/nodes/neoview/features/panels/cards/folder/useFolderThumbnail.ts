import { QueryClient, useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useSyncExternalStore } from "react"

import {
  FolderThumbnailProbeError,
  folderThumbnailProbeRetryDelay,
  isManagedFolderThumbnailUrl,
  probeFolderThumbnailUrls,
  retryFolderThumbnailProbe,
} from "./FolderThumbnailProbe"
import type {
  FolderThumbnailEntrySnapshot,
  FolderThumbnailStore,
} from "./FolderThumbnailStore"

const folderThumbnailQueryClient = new QueryClient()
const EMPTY_THUMBNAIL: FolderThumbnailEntrySnapshot = Object.freeze({ availability: "missing", revision: 0 })

export function useFolderThumbnail(
  store: FolderThumbnailStore | undefined,
  path?: string,
  enabled = true,
  probeEnabled = true,
): FolderThumbnailEntrySnapshot {
  const activePath = enabled ? path : undefined
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(activePath, listener) ?? (() => undefined),
    [activePath, store],
  )
  const getSnapshot = useCallback(() => store?.entry(activePath) ?? EMPTY_THUMBNAIL, [activePath, store])
  const registered = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const candidates = registered.thumbnailUrls ?? (registered.thumbnailUrl ? [registered.thumbnailUrl] : [])
  const managedUrls = candidates.filter(isManagedFolderThumbnailUrl)
  const immediateUrls = candidates.filter((url) => !isManagedFolderThumbnailUrl(url))
  const probe = useQuery({
    queryKey: ["neoview", "folder-thumbnail-probe", store?.queryScope ?? 0, activePath ?? "", registered.revision, ...managedUrls],
    queryFn: ({ signal }) => probeFolderThumbnailUrls(managedUrls, signal),
    enabled: Boolean(probeEnabled && activePath && managedUrls.length),
    retry: retryFolderThumbnailProbe,
    retryDelay: folderThumbnailProbeRetryDelay,
    staleTime: Infinity,
    gcTime: 30_000,
    networkMode: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }, folderThumbnailQueryClient)

  useEffect(() => store?.activate(activePath), [activePath, store])

  useEffect(() => {
    if (!probeEnabled || !activePath || !probe.isSuccess) return
    store?.reportProbeReady(activePath, registered.revision)
  }, [activePath, probe.isSuccess, probe.dataUpdatedAt, probeEnabled, registered.revision, store])

  useEffect(() => {
    if (!probeEnabled || !activePath || !probe.isError) return
    const recoverable = probe.error instanceof FolderThumbnailProbeError
      && (probe.error.kind === "stale" || probe.error.kind === "unavailable")
    store?.reportProbeError(activePath, registered.revision, recoverable)
  }, [activePath, probe.error, probe.isError, probeEnabled, registered.revision, store])

  if (!activePath || !candidates.length) return registered
  if (!managedUrls.length) return resolvedThumbnail(registered, "ready", candidates)
  if (!probeEnabled) return resolvedThumbnail(registered, registered.availability, candidates)
  if (probe.isSuccess) return resolvedThumbnail(registered, "ready", candidates)
  const failure = probe.failureReason
  if (probe.isFetching && failure instanceof FolderThumbnailProbeError && failure.kind === "generating") {
    return resolvedThumbnail(registered, "generating", candidates)
  }
  if (probe.isError && registered.availability === "unavailable") {
    return resolvedThumbnail(registered, "unavailable", immediateUrls)
  }
  if (probe.isError) {
    const awaitsRegistration = probe.error instanceof FolderThumbnailProbeError
      && (probe.error.kind === "stale" || probe.error.kind === "unavailable")
    return resolvedThumbnail(registered, awaitsRegistration ? "checking" : "failed", awaitsRegistration ? immediateUrls : candidates)
  }
  return resolvedThumbnail(registered, "checking", candidates)
}

function resolvedThumbnail(
  registered: FolderThumbnailEntrySnapshot,
  availability: FolderThumbnailEntrySnapshot["availability"],
  thumbnailUrls: readonly string[],
): FolderThumbnailEntrySnapshot {
  return {
    availability,
    revision: registered.revision,
    ...(thumbnailUrls.length ? { thumbnailUrl: thumbnailUrls[0], thumbnailUrls } : {}),
  }
}
