import { mkdir, mkdtemp, open, rm, stat, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import type { ReaderPage } from "../../domain/page/page.js"
import { waitWithAbort } from "../../domain/page/wait-with-abort.js"
import type { ReaderPageMaterializer, ReaderPageMaterializationLease } from "../../ports/ReaderPageMaterializer.js"
import type { ResourceScheduler } from "../../ports/ResourceScheduler.js"
import { defaultImageTransformScheduler } from "../scheduler/PriorityResourceScheduler.js"
import { isNativeSuperResolutionInput } from "../../domain/super-resolution/native-super-resolution-input.js"

export interface PlatformReaderPageMaterializerOptions {
  tempDirectory?: string
  resourceScheduler?: ResourceScheduler
  purpose?: "clipboard" | "seekable-media" | "super-resolution"
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
    const purpose = this.options.purpose ?? "clipboard"
    const profile = materializationProfile(purpose)
    const resourceLease = await scheduler.acquire({
      resource: "io",
      kind: profile.kind,
      priority: "interactive",
      ownerId: profile.ownerId,
    }, signal)
    let root: string | undefined
    let handle: FileHandle | undefined
    let source: Awaited<ReturnType<ReaderPage["content"]["load"]>> | undefined
    try {
      const parent = this.options.tempDirectory ?? tmpdir()
      await mkdir(parent, { recursive: true })
      root = await mkdtemp(join(parent, profile.prefix))
      const path = join(root, safeFileName(page.name))
      handle = await open(path, "wx")
      source = await waitWithAbort(page.content.load(signal), signal, (lateSource) => lateSource.close())
      const stream = await waitWithAbort(
        source.open(signal, undefined, { resourceLease }),
        signal,
        (lateStream) => lateStream.cancel(signal?.reason),
      )
      const reader = stream.getReader()
      let written = 0
      try {
        for (;;) {
          const result = await readWithAbort(reader, signal)
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
      if (purpose === "super-resolution" && !isNativeSuperResolutionInput(page)) {
        const nativePath = join(root, "xr-native-input.png")
        const { default: sharp } = await import("sharp")
        await sharp(path, { animated: false }).png({ compressionLevel: 1 }).toFile(nativePath)
        const nativeFile = await stat(nativePath)
        if (!nativeFile.isFile() || nativeFile.size <= 0 || nativeFile.size > maxBytes) {
          throw new Error(`Reader page transcoded outside its super-resolution materialization budget: ${page.name}`)
        }
        await rm(path, { force: true })
        return temporaryLease(nativePath, root, nativeFile.size)
      }
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

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>> {
  signal?.throwIfAborted()
  if (!signal) return reader.read()
  let cancellation: Promise<void> | undefined
  const cancel = (reason: unknown): Promise<void> => cancellation ??= reader.cancel(reason).catch(() => undefined)
  const onAbort = () => {
    void cancel(signal.reason)
  }
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    return await waitWithAbort(reader.read(), signal, () => cancel(signal.reason))
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

function materializationProfile(purpose: NonNullable<PlatformReaderPageMaterializerOptions["purpose"]>) {
  switch (purpose) {
    case "clipboard":
      return { kind: "neoview.clipboard-materialize", ownerId: "neoview:clipboard-materialize", prefix: "xiranite-neoview-clipboard-" }
    case "seekable-media":
      return { kind: "neoview.media-materialize", ownerId: "neoview:media-materialize", prefix: "xiranite-neoview-media-" }
    case "super-resolution":
      return { kind: "neoview.super-resolution-materialize", ownerId: "neoview:super-resolution-materialize", prefix: "xiranite-neoview-upscale-" }
  }
}

function temporaryLease(path: string, root: string, byteLength: number): ReaderPageMaterializationLease {
  let releasing: Promise<void> | undefined
  const release = (): Promise<void> => releasing ??= rm(root, { recursive: true, force: true })
  return { path, byteLength, release, [Symbol.asyncDispose]: release }
}

function safeFileName(value: string): string {
  let name = stripControlCharacters(basename(value)).replace(/[<>:"/\\|?*]/g, "_").replace(/[ .]+$/g, "")
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = `page-${name || "content"}`
  return name.slice(0, 240)
}

function stripControlCharacters(value: string): string {
  return [...value].map((character) => (character.codePointAt(0) ?? 0) < 32 ? "_" : character).join("")
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset)
    if (bytesWritten <= 0) throw new Error("Reader clipboard materialization could not make forward write progress.")
    offset += bytesWritten
  }
}
