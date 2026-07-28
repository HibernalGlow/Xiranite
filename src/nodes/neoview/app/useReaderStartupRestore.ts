import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ReaderHttpClient, ReaderRuntimeConfigDto } from "../adapters/reader-http-client"
import { readerStartupRestorePath } from "./ReaderStartupRestore"
import type { ReaderExternalOpenRequest } from "./ReaderAppModules"

export interface ReaderStartupRestorePreference {
  restoreLastBook: boolean
  canUpdate: boolean
  pending: boolean
  setRestoreLastBook(value: boolean): Promise<void>
}

export interface ReaderStartupRestoreController extends ReaderStartupRestorePreference {
  hydrate(config: ReaderRuntimeConfigDto["startup"]): void
}

interface UseReaderStartupRestoreOptions {
  client: ReaderHttpClient
  initialPath: string
  externalOpenRequest: ReaderExternalOpenRequest | undefined
  open: (path: string) => Promise<unknown>
  onError?(cause: unknown): void
}

export function useReaderStartupRestore({
  client,
  initialPath,
  externalOpenRequest,
  open,
  onError,
}: UseReaderStartupRestoreOptions): ReaderStartupRestoreController {
  const completedRef = useRef(false)
  const openRef = useRef(open)
  const clientRef = useRef(client)
  const initialPathRef = useRef(initialPath)
  const externalOpenRequestRef = useRef(externalOpenRequest)
  const onErrorRef = useRef(onError)
  const requestRef = useRef<AbortController>()
  const preferenceRef = useRef({ restoreLastBook: false, canUpdate: false, pending: false })
  const [preference, setPreferenceState] = useState(preferenceRef.current)
  openRef.current = open
  clientRef.current = client
  initialPathRef.current = initialPath
  externalOpenRequestRef.current = externalOpenRequest
  onErrorRef.current = onError

  const setPreference = useCallback((next: typeof preferenceRef.current) => {
    preferenceRef.current = next
    setPreferenceState(next)
  }, [])

  const startRestore = useCallback((config: NonNullable<ReaderRuntimeConfigDto["startup"]>) => {
    if (completedRef.current || !config.restoreLastBook) {
      completedRef.current = true
      return
    }
    const initial = initialPathRef.current
    const external = externalOpenRequestRef.current
    if (initial.trim() || external) {
      completedRef.current = true
      return
    }
    const startupState = clientRef.current.startupState
    if (!startupState) {
      completedRef.current = true
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    void startupState(controller.signal)
      .then((state) => {
        if (controller.signal.aborted) return
        const path = readerStartupRestorePath(state, {
          initialPath: initialPathRef.current,
          hasExternalOpenRequest: Boolean(externalOpenRequestRef.current),
        })
        completedRef.current = true
        if (path) return openRef.current(path).then(() => undefined).catch(onErrorRef.current)
      })
      .catch(() => {
        if (!controller.signal.aborted) completedRef.current = true
      })
  }, [])

  const hydrate = useCallback((config: ReaderRuntimeConfigDto["startup"]) => {
    if (!config) {
      requestRef.current?.abort()
      completedRef.current = true
      setPreference({ restoreLastBook: false, canUpdate: false, pending: false })
      return
    }
    const current = preferenceRef.current
    if (!current.pending) {
      setPreference({
        restoreLastBook: config.restoreLastBook,
        canUpdate: Boolean(clientRef.current.updateStartup),
        pending: false,
      })
    }
    startRestore(config)
  }, [setPreference, startRestore])

  const setRestoreLastBook = useCallback(async (restoreLastBook: boolean) => {
    const previous = preferenceRef.current
    const updateStartup = clientRef.current.updateStartup
    if (!previous.canUpdate || !updateStartup) return
    if (!restoreLastBook) {
      completedRef.current = true
      requestRef.current?.abort()
    }
    setPreference({ ...previous, restoreLastBook, pending: true })
    try {
      const updated = await updateStartup({ startup: { restoreLastBook } })
      setPreference({ restoreLastBook: updated.restoreLastBook, canUpdate: true, pending: false })
    } catch (cause) {
      setPreference({ ...previous, pending: false })
      onErrorRef.current?.(cause)
    }
  }, [setPreference])

  useEffect(() => () => { requestRef.current?.abort() }, [])

  return useMemo(() => ({ ...preference, hydrate, setRestoreLastBook }), [hydrate, preference, setRestoreLastBook])
}
