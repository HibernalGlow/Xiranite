import {
  DEFAULT_READER_SWITCH_TOAST,
  normalizeReaderSwitchToast,
  type ReaderSwitchToastPatch,
  type ReaderSwitchToastSettings,
} from "@xiranite/node-neoview/ui-core"
import {
  createReaderOptimisticSettingsStore,
  type ReaderOptimisticSettingsPort,
} from "../settings/ReaderOptimisticSettingsStore"

export interface ReaderSwitchToastMessage {
  id: number
  title: string
  description?: string
  durationMs: number
}

type ReaderSwitchToastSettingsPort = ReaderOptimisticSettingsPort<ReaderSwitchToastSettings, ReaderSwitchToastPatch>

export interface ReaderSwitchToastPort extends ReaderSwitchToastSettingsPort {
  subscribeMessages(listener: () => void): () => void
  getMessages(): readonly ReaderSwitchToastMessage[]
  show(message: { title: string; description?: string; durationMs?: number }): void
  dismiss(id: number): void
}

export interface ReaderSwitchToastStoreOptions {
  persist(settings: ReaderSwitchToastSettings, reset: boolean, signal: AbortSignal): Promise<ReaderSwitchToastSettings>
  onError?(cause: unknown): void
  saveTimeoutMs?: number
}

export function createReaderSwitchToastStore(options: ReaderSwitchToastStoreOptions): ReaderSwitchToastPort {
  const settings = createReaderOptimisticSettingsStore({
    initial: DEFAULT_READER_SWITCH_TOAST,
    apply: (current, patch) => ({ ...current, ...patch }),
    normalize: normalizeReaderSwitchToast,
    equals: sameSettings,
    ...options,
  })
  let disposed = false
  let messages: readonly ReaderSwitchToastMessage[] = []
  let nextMessageId = 1
  let lastMessageKey = ""
  let lastMessageAt = 0
  const messageListeners = new Set<() => void>()
  const messageTimers = new Map<number, ReturnType<typeof setTimeout>>()

  const publishMessages = (next: readonly ReaderSwitchToastMessage[]) => {
    messages = next
    for (const listener of messageListeners) listener()
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
    ...settings,
    subscribeMessages(listener) {
      if (disposed) return () => undefined
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
      if (disposed) return
      disposed = true
      settings.dispose()
      for (const timer of messageTimers.values()) clearTimeout(timer)
      messageTimers.clear()
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
