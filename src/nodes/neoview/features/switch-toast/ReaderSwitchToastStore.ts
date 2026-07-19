import {
  DEFAULT_READER_SWITCH_TOAST,
  normalizeReaderSwitchToast,
  type ReaderSwitchToastPatch,
  type ReaderSwitchToastSettings,
} from "@xiranite/node-neoview/switch-toast"
import { persistReaderSettingsWithTimeout } from "../reader/reader-settings-save-timeout"

export interface ReaderSwitchToastMessage {
  id: number
  title: string
  description?: string
  durationMs: number
}

export interface ReaderSwitchToastPort {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReaderSwitchToastSettings
  hydrate(settings: ReaderSwitchToastSettings): void
  preview(patch: ReaderSwitchToastPatch): void
  commit(reset?: boolean): Promise<void>
  update(patch: ReaderSwitchToastPatch): Promise<void>
  reset(): Promise<void>
  subscribeMessages(listener: () => void): () => void
  getMessages(): readonly ReaderSwitchToastMessage[]
  show(message: { title: string; description?: string; durationMs?: number }): void
  dismiss(id: number): void
  dispose(): void
}

export interface ReaderSwitchToastStoreOptions {
  persist(
    settings: ReaderSwitchToastSettings,
    reset: boolean,
    signal: AbortSignal,
  ): Promise<ReaderSwitchToastSettings>
  onError?(cause: unknown): void
  saveTimeoutMs?: number
}

export function createReaderSwitchToastStore(options: ReaderSwitchToastStoreOptions): ReaderSwitchToastPort {
  let snapshot = { ...DEFAULT_READER_SWITCH_TOAST }
  let confirmed = snapshot
  let touched = false
  let disposed = false
  let revision = 0
  let requestedRevision = 0
  let resetRequested = false
  let write: Promise<void> | undefined
  let messages: readonly ReaderSwitchToastMessage[] = []
  let nextMessageId = 1
  let lastMessageKey = ""
  let lastMessageAt = 0
  const listeners = new Set<() => void>()
  const messageListeners = new Set<() => void>()
  const messageTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const controller = new AbortController()

  const publish = (next: ReaderSwitchToastSettings) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const publishMessages = (next: readonly ReaderSwitchToastMessage[]) => {
    messages = next
    for (const listener of messageListeners) listener()
  }
  const preview = (patch: ReaderSwitchToastPatch) => {
    if (disposed) return
    touched = true
    revision += 1
    publish(normalizeReaderSwitchToast({ ...snapshot, ...patch }))
  }
  const commit = (reset = false): Promise<void> => {
    if (disposed) return Promise.resolve()
    requestedRevision = revision
    resetRequested ||= reset
    write ??= drain().finally(() => { write = undefined })
    return write
  }

  async function drain(): Promise<void> {
    while (!disposed) {
      const targetRevision = requestedRevision
      const target = snapshot
      const reset = resetRequested
      resetRequested = false
      if (!reset && sameSettings(target, confirmed)) return
      try {
        const updated = normalizeReaderSwitchToast(await persistReaderSettingsWithTimeout({
          persist: (signal) => options.persist(target, reset, signal),
          signal: controller.signal,
          timeoutMs: options.saveTimeoutMs,
        }))
        confirmed = updated
        if (revision === targetRevision) publish(updated)
      } catch (cause) {
        if (controller.signal.aborted) return
        if (revision === targetRevision) publish(confirmed)
        options.onError?.(cause)
        throw cause
      }
      if (requestedRevision === targetRevision) return
    }
  }

  function dismiss(id: number): void {
    const timer = messageTimers.get(id)
    if (timer) clearTimeout(timer)
    messageTimers.delete(id)
    if (messages.some((message) => message.id === id)) {
      publishMessages(messages.filter((message) => message.id !== id))
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    hydrate(settings) {
      if (disposed || touched) return
      confirmed = normalizeReaderSwitchToast(settings)
      publish(confirmed)
    },
    preview,
    commit,
    async update(patch) {
      preview(patch)
      await commit()
    },
    async reset() {
      touched = true
      revision += 1
      publish({ ...DEFAULT_READER_SWITCH_TOAST })
      await commit(true)
    },
    subscribeMessages(listener) {
      messageListeners.add(listener)
      return () => messageListeners.delete(listener)
    },
    getMessages: () => messages,
    show({ title, description, durationMs = 3_000 }) {
      if (disposed || (!title && !description)) return
      const key = `${title}\n${description ?? ""}`
      const now = Date.now()
      if (key === lastMessageKey && now - lastMessageAt < 500) return
      lastMessageKey = key
      lastMessageAt = now
      const message: ReaderSwitchToastMessage = {
        id: nextMessageId++,
        title,
        ...(description ? { description } : {}),
        durationMs,
      }
      const next = [...messages, message].slice(-3)
      const retained = new Set(next.map((entry) => entry.id))
      for (const id of messageTimers.keys()) {
        if (!retained.has(id)) dismiss(id)
      }
      publishMessages(next)
      messageTimers.set(message.id, setTimeout(() => dismiss(message.id), durationMs))
    },
    dismiss,
    dispose() {
      disposed = true
      controller.abort()
      for (const timer of messageTimers.values()) clearTimeout(timer)
      messageTimers.clear()
      listeners.clear()
      messageListeners.clear()
      messages = []
    },
  }
}

function sameSettings(left: ReaderSwitchToastSettings, right: ReaderSwitchToastSettings): boolean {
  return Object.keys(DEFAULT_READER_SWITCH_TOAST).every((key) => (
    left[key as keyof ReaderSwitchToastSettings] === right[key as keyof ReaderSwitchToastSettings]
  ))
}
