import { open, type FileHandle } from "node:fs/promises"
import { Reader } from "@zip.js/zip.js/index-native.js"

/** Bridges zip.js random-access reads to an archive on the local Node filesystem. */
export class CoveruZipFileReader extends Reader<string> {
  #handle: FileHandle | undefined
  #initializing: Promise<void> | undefined
  #closed = false

  constructor(readonly path: string) {
    super(path)
  }

  override async init(): Promise<void> {
    if (this.#closed) throw new Error(`ZIP file reader is closed: ${this.path}`)
    if (this.#handle) return
    if (!this.#initializing) this.#initializing = this.open()
    try {
      await this.#initializing
    } finally {
      this.#initializing = undefined
    }
  }

  override async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
    await this.init()
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
      throw new RangeError(`Invalid ZIP file read: offset=${offset}, length=${length}`)
    }
    if (offset >= this.size || length === 0) return new Uint8Array()
    const output = new Uint8Array(Math.min(length, this.size - offset))
    const handle = this.#handle
    if (!handle || this.#closed) throw new Error(`ZIP file reader is closed: ${this.path}`)
    const { bytesRead } = await handle.read(output, 0, output.byteLength, offset)
    return bytesRead === output.byteLength ? output : output.subarray(0, bytesRead)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#initializing?.catch(() => undefined)
    const handle = this.#handle
    this.#handle = undefined
    await handle?.close()
  }

  async open(): Promise<void> {
    const handle = await open(this.path, "r")
    try {
      const info = await handle.stat()
      if (!info.isFile()) throw new Error(`ZIP source is not a file: ${this.path}`)
      if (!Number.isSafeInteger(info.size)) throw new RangeError(`ZIP source exceeds JavaScript safe file size: ${info.size}`)
      this.#handle = handle
      this.size = info.size
      await super.init?.()
    } catch (error) {
      await handle.close()
      throw error
    }
  }
}
