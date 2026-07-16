import { mkdir, mkdtemp, open, rm, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import type { ReaderPage } from "../../domain/page/page.js"
import type { ReaderPageMaterializer, ReaderPageMaterializationLease } from "../../ports/ReaderPageMaterializer.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../scheduler/PriorityResourceScheduler.js"

export interface PlatformReaderPageMaterializerOptions {
  tempDirectory?: string
  resourceScheduler?: ResourceScheduler
}

export class PlatformReaderPageMaterializer implements ReaderPageMaterializer {
  constructor(private readonly options: PlatformReaderPageMaterializerOptions = {}) {}

  async materialize(
    page: ReaderPage,
    options: { signal?: AbortSignal; maxBytes?: number } = {},
  ): Promise<ReaderPageMaterializationLease> {
    const signal = options.signal
    signal?.throwIfAborted()
    const maxBytes = options.maxBytes ?? 512 * 1024 * 1024
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive integer")
    if (page.byteLength !== undefined && page.byteLength > maxBytes) {
      throw new Error(`Reader page requires ${page.byteLength} bytes, exceeding the ${maxBytes} byte budget.`)
    }

    const scheduler = this.options.resourceScheduler ?? defaultImageTransformScheduler
    const resourceLease = await scheduler.acquire({
      resource: "io",
      kind: "neoview.clipboard-materialize",
      priority: "interactive",
      ownerId: "neoview:clipboard-materialize",
    }, signal)
    let root: string | undefined
    let handle: FileHandle | undefined
    let source: Awaited<ReturnType<ReaderPage["content"]["load"]>> | undefined
    try {
      const parent = this.options.tempDirectory ?? tmpdir()
      await mkdir(parent, { recursive: true })
      root = await mkdtemp(join(parent, "xiranite-neoview-clipboard-"))
      const path = join(root, safeFileName(page.name))
      handle = await open(path, "wx")
      source = await page.content.load(signal)
      const stream = await source.open(signal, undefined, { resourceLease })
      const reader = stream.getReader()
      let written = 0
      try {
        for (;;) {
          signal?.throwIfAborted()
          const result = await reader.read()
          if (result.done) break
          written += result.value.byteLength
          if (written > maxBytes || (page.byteLength !== undefined && written > page.byteLength)) {
            throw new Error(`Reader page emitted more than its declared clipboard materialization budget: ${page.name}`)
          }
          await writeAll(handle, result.value)
        }
      } finally {
        await reader.cancel("reader clipboard materialization finished").catch(() => undefined)
        reader.releaseLock()
      }
      if (page.byteLength !== undefined && written !== page.byteLength) {
        throw new Error(`Reader page emitted ${written} bytes, expected ${page.byteLength}: ${page.name}`)
      }
      await handle.close()
      handle = undefined
      await source.close()
      source = undefined
      return temporaryLease(path, root, written)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await source?.close().catch(() => undefined)
      if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
      throw error
    } finally {
      resourceLease.release()
    }
  }
}

function temporaryLease(path: string, root: string, byteLength: number): ReaderPageMaterializationLease {
  let releasing: Promise<void> | undefined
  const release = (): Promise<void> => releasing ??= rm(root, { recursive: true, force: true })
  return { path, byteLength, release, [Symbol.asyncDispose]: release }
}

function safeFileName(value: string): string {
  let name = basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[ .]+$/g, "")
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = `page-${name || "content"}`
  return name.slice(0, 240)
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset)
    if (bytesWritten <= 0) throw new Error("Reader clipboard materialization could not make forward write progress.")
    offset += bytesWritten
  }
}
