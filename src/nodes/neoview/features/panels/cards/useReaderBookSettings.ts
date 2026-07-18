import { useCallback, useEffect, useRef, useState } from "react"

import type {
  ReaderBookSettingsPatchDto,
  ReaderBookSettingsSnapshotDto,
  ReaderBookSettingsUpdateDto,
  ReaderHttpClient,
} from "../../../adapters/reader-http-client"

export interface ReaderBookSettingsState {
  loading: boolean
  saving: boolean
  value?: ReaderBookSettingsSnapshotDto
  error?: string
  retry(): void
  update(patch: ReaderBookSettingsPatchDto): Promise<void>
}

export function useReaderBookSettings(
  client: ReaderHttpClient,
  sessionId: string,
  onUpdated?: (sessionId: string, update: ReaderBookSettingsUpdateDto) => void,
): ReaderBookSettingsState {
  const [reloadVersion, setReloadVersion] = useState(0)
  const [state, setState] = useState<Omit<ReaderBookSettingsState, "retry" | "update">>({ loading: true, saving: false })
  const controllerRef = useRef<AbortController>()
  const valueRef = useRef<ReaderBookSettingsSnapshotDto>()

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    valueRef.current = undefined
    setState({ loading: true, saving: false })
    void (client.bookSettings
      ? client.bookSettings(sessionId, controller.signal)
      : Promise.reject(new Error("Reader book settings API is unavailable."))
    ).then((value) => {
      if (controller.signal.aborted) return
      valueRef.current = value
      setState({ loading: false, saving: false, value })
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ loading: false, saving: false, error: errorMessage(error) })
    })
    return () => {
      controller.abort()
      if (controllerRef.current === controller) controllerRef.current = undefined
    }
  }, [client, reloadVersion, sessionId])

  const retry = useCallback(() => setReloadVersion((value) => value + 1), [])
  const update = useCallback(async (patch: ReaderBookSettingsPatchDto) => {
    const confirmed = valueRef.current
    if (!confirmed || !client.updateBookSettings) return
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    setState({ loading: false, saving: true, value: optimisticSnapshot(confirmed, patch) })
    try {
      const result = await client.updateBookSettings(sessionId, confirmed.revision, patch, controller.signal)
      if (controller.signal.aborted) return
      valueRef.current = result.settings
      setState({ loading: false, saving: false, value: result.settings })
      onUpdated?.(sessionId, result)
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ loading: false, saving: false, value: confirmed, error: errorMessage(error) })
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = undefined
    }
  }, [client, onUpdated, sessionId])

  return { ...state, retry, update }
}

function optimisticSnapshot(
  snapshot: ReaderBookSettingsSnapshotDto,
  patch: ReaderBookSettingsPatchDto,
): ReaderBookSettingsSnapshotDto {
  const effective = { ...snapshot.effective }
  const overrides = { ...snapshot.overrides }
  const inherited = new Set(snapshot.inherited)
  for (const [key, value] of Object.entries(patch) as Array<[
    keyof ReaderBookSettingsPatchDto,
    ReaderBookSettingsPatchDto[keyof ReaderBookSettingsPatchDto],
  ]>) {
    if (value === null) {
      delete overrides[key]
      inherited.add(key)
      continue
    } else if (value !== undefined) {
      Object.assign(overrides, { [key]: value })
      Object.assign(effective, { [key]: value })
      inherited.delete(key)
    }
  }
  return { ...snapshot, overrides, effective, inherited: [...inherited] }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
