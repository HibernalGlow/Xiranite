import type { ReaderRuntimeConfigDto, ReaderShellConfigDto } from "./reader-http-contract"

type LoadConfig = () => Promise<ReaderRuntimeConfigDto>
type WriteShell = (expectedRevision: number | undefined) => Promise<ReaderShellConfigDto>

export class ReaderShellMutationCoordinator {
  #queue: Promise<void> = Promise.resolve()
  #initialized = false
  #revision: number | undefined

  read(load: LoadConfig, signal?: AbortSignal): Promise<ReaderRuntimeConfigDto> {
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      const config = await load()
      this.#observe(config.shell)
      return config
    })
  }

  write(
    requiresRevision: boolean,
    load: LoadConfig,
    write: WriteShell,
    signal?: AbortSignal,
  ): Promise<ReaderShellConfigDto> {
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      if (requiresRevision && !this.#initialized) {
        const config = await load()
        this.#observe(config.shell)
        throwIfAborted(signal)
      }
      const shell = await write(this.#revision)
      this.#observe(shell)
      return shell
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation)
    this.#queue = result.then(() => undefined, () => undefined)
    return result
  }

  #observe(shell: ReaderShellConfigDto): void {
    this.#initialized = true
    const revision = shell.revision
    this.#revision = Number.isSafeInteger(revision) && revision! >= 0 ? revision : undefined
  }
}

const coordinators = new Map<string, ReaderShellMutationCoordinator>()

export function readerShellMutationCoordinator(key: string): ReaderShellMutationCoordinator {
  const existing = coordinators.get(key)
  if (existing) return existing
  const coordinator = new ReaderShellMutationCoordinator()
  coordinators.set(key, coordinator)
  return coordinator
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
}
