import { open, type FileHandle } from "node:fs/promises"
import { Reader } from "@zip.js/zip.js/index-native.js"

export interface NodeFileReaderOptions {
  onRead?: (offset: number, length: number, bytesRead: number) => void
}

export class NodeFileReader extends Reader<string> implements AsyncDisposable {
  #handle: FileHandle | null = null
  #closed = false
  #initializing: Promise<void> | null = null
  readonly #onRead?: NodeFileReaderOptions["onRead"]

  constructor(readonly path: string, options: NodeFileReaderOptions = {}) {
    super(path)
    this.#onRead = options.onRead
  }

  override async init(): Promise<void> {
    if (this.#closed) throw new Error(`ZIP file reader is closed: ${this.path}`)
    if (this.#handle) return
    if (this.#initializing) return this.#initializing
    this.#initializing = (async () => {
      const handle = await open(this.path, "r")
      try {
        const stats = await handle.stat()
        if (!stats.isFile()) throw new Error(`ZIP source is not a file: ${this.path}`)
        if (!Number.isSafeInteger(stats.size)) throw new RangeError(`ZIP source exceeds JavaScript safe file size: ${stats.size}`)
        this.#handle = handle
        this.size = stats.size
        await super.init?.()
      } catch (error) {
        await handle.close()
        throw error
      }
    })()
    try {
      await this.#initializing
    } finally {
      this.#initializing = null
    }
  }

  override async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
    await this.init()
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
      throw new RangeError(`Invalid ZIP file read: offset=${offset}, length=${length}`)
    }
    if (offset >= this.size || length === 0) return new Uint8Array()
    const boundedLength = Math.min(length, this.size - offset)
    const output = new Uint8Array(boundedLength)
    const handle = this.#handle
    if (!handle || this.#closed) throw new Error(`ZIP file reader is closed: ${this.path}`)
    const { bytesRead } = await handle.read(output, 0, boundedLength, offset)
    this.#onRead?.(offset, boundedLength, bytesRead)
    return bytesRead === output.byteLength ? output : output.subarray(0, bytesRead)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#initializing?.catch(() => undefined)
    const handle = this.#handle
    this.#handle = null
    await handle?.close()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
