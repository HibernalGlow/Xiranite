export const BACKEND_RESTART_HANDOFF_MS = 3_000

export interface ClosableBackend {
  close(): void | Promise<void>
}

export function closeBackendAfterHandoff(backend: ClosableBackend | null | undefined): void {
  if (!backend) return
  setTimeout(() => { void backend.close() }, BACKEND_RESTART_HANDOFF_MS)
}
