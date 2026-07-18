import { mkdir, open, mkdtemp, rm, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ArchiveEntry, ArchiveProvider, MaterializedEntryLease } from "../../ports/ArchiveProvider.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../scheduler/PriorityResourceScheduler.js"

export interface MaterializeArchiveEntryOptions {
  signal?: AbortSignal
  tempDirectory?: string
  maxBytes?: number
  resourceScheduler?: ResourceScheduler
  rawPassword?: Uint8Array
}

export async function materializeArchiveEntry(
  provider: ArchiveProvider,
  entry: ArchiveEntry,
  options: MaterializeArchiveEntryOptions = {},
): Promise<MaterializedEntryLease> {
  try {
    return await materializeArchiveEntryCore(provider, entry, options)
  } finally {
    options.rawPassword?.fill(0)
  }
}

async function materializeArchiveEntryCore(
  provider: ArchiveProvider,
  entry: ArchiveEntry,
  options: MaterializeArchiveEntryOptions,
): Promise<MaterializedEntryLease> {
  const signal = options.signal
  signal?.throwIfAborted()
  if (entry.kind !== "file") throw new Error(`Archive entry is not a file: ${entry.path}`)
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024 * 1024
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError(`Invalid archive materialization budget: ${maxBytes}`)
  if (entry.uncompressedSize > maxBytes) {
    throw new Error(`Archive entry requires ${entry.uncompressedSize} materialized bytes, exceeding the ${maxBytes} byte budget.`)
  }
  const scheduler = options.resourceScheduler ?? defaultImageTransformScheduler
  const lease = await scheduler.acquire({
    resource: "io",
    kind: "neoview.archive-materialize",
    priority: "interactive",
  }, signal)
  let root: string | undefined
  let handle: FileHandle | undefined
  try {
    const parent = options.tempDirectory ?? tmpdir()
    await mkdir(parent, { recursive: true })
    root = await mkdtemp(join(parent, "xiranite-neoview-entry-"))
    const path = join(root, "materialized.entry")
    handle = await open(path, "wx")
    const stream = await provider.openEntry(entry.id, { signal, rawPassword: options.rawPassword })
    const reader = stream.getReader()
    let written = 0
    try {
      for (;;) {
        signal?.throwIfAborted()
        const result = await reader.read()
        if (result.done) break
        written += result.value.byteLength
        if (written > entry.uncompressedSize || written > maxBytes) {
          throw new Error(`Archive entry emitted more than its declared ${entry.uncompressedSize} bytes: ${entry.path}`)
        }
        await writeAll(handle, result.value)
      }
    } finally {
      await reader.cancel("archive entry materialization finished").catch(() => undefined)
      reader.releaseLock()
    }
    if (written !== entry.uncompressedSize) {
      throw new Error(`Archive entry emitted ${written} bytes, expected ${entry.uncompressedSize}: ${entry.path}`)
    }
    await handle.close()
    handle = undefined
    return temporaryLease(path, root)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
    throw error
  } finally {
    lease.release()
  }
}

function temporaryLease(path: string, root: string): MaterializedEntryLease {
  let releasing: Promise<void> | undefined
  const release = (): Promise<void> => {
    releasing ??= rm(root, { recursive: true, force: true })
    return releasing
  }
  return { path, release, [Symbol.asyncDispose]: release }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset)
    if (bytesWritten <= 0) throw new Error("Archive materialization could not make forward write progress.")
    offset += bytesWritten
  }
}
