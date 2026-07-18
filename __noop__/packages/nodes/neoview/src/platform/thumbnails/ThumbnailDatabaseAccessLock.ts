import { lock } from "proper-lockfile"
import { realpath } from "node:fs/promises"

const DEFAULT_STALE_MS = 30 * 60_000
const DEFAULT_UPDATE_MS = 10_000

export interface ThumbnailDatabaseAccessLock extends AsyncDisposable {
  readonly databasePath: string
  readonly lockfilePath: string
  assertHeld(): void
  release(): Promise<void>
}

export async function acquireThumbnailDatabaseAccessLock(
  databasePath: string,
  signal?: AbortSignal,
): Promise<ThumbnailDatabaseAccessLock> {
  signal?.throwIfAborted()
  const canonicalPath = await realpath(databasePath)
  signal?.throwIfAborted()
  const lockfilePath = `${canonicalPath}.xr-write.lock`
  let compromised: Error | undefined
  let releaseLock: (() => Promise<void>) | undefined
  try {
    releaseLock = await lock(canonicalPath, {
      lockfilePath,
      realpath: true,
      retries: 0,
      stale: DEFAULT_STALE_MS,
      update: DEFAULT_UPDATE_MS,
      onCompromised: (error) => { compromised = error },
    })
  } catch (error) {
    if (isAlreadyLocked(error)) {
      throw new ThumbnailDatabaseAccessLockedError(canonicalPath, { cause: error })
    }
    throw error
  }

  if (signal?.aborted) {
    await releaseLock()
    signal.throwIfAborted()
  }

  let released = false
  const lease: ThumbnailDatabaseAccessLock = {
    databasePath: canonicalPath,
    lockfilePath,
    assertHeld() {
      if (released) throw new Error("Thumbnail database access lock was released.")
      if (compromised) throw new Error("Thumbnail database access lock was compromised.", { cause: compromised })
    },
    async release() {
      if (released) return
      released = true
      await releaseLock!()
    },
    async [Symbol.asyncDispose]() {
      await lease.release()
    },
  }
  return lease
}

export class ThumbnailDatabaseAccessLockedError extends Error {
  constructor(databasePath: string, options?: ErrorOptions) {
    super(`NeoView thumbnail database is already in use by another Xiranite writer or maintenance process: ${databasePath}`, options)
    this.name = "ThumbnailDatabaseAccessLockedError"
  }
}

function isAlreadyLocked(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ELOCKED"
}
