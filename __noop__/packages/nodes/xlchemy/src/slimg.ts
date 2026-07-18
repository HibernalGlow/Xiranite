import { access, writeFile } from "node:fs/promises"
import type { Pointer } from "bun:ffi"
import type { XlchemyToolStatus } from "./core.js"

const DEFAULT_SLIMG_DLL = "C:\\Windows\\System32\\slimg_cffi.dll"
const AVIF_FORMAT = 3

export async function probeSlimg(): Promise<XlchemyToolStatus> {
  const path = slimgDllPath()
  try { await access(path) } catch { return { id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF 编码", path, available: false, runnable: false, detail: "DLL 不存在" } }
  try {
    const { dlopen } = await import("bun:ffi")
    const library = dlopen(path, { slimg_format_can_encode: { args: ["i32"], returns: "i32" } })
    try {
      const runnable = library.symbols.slimg_format_can_encode(AVIF_FORMAT) === 1
      return { id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF 编码", path, available: true, runnable, detail: runnable ? "DLL 已加载，支持 AVIF 编码" : "DLL 已加载，但不支持 AVIF 编码" }
    } finally { library.close() }
  } catch (error) {
    return { id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF 编码", path, available: true, runnable: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

export async function convertWithSlimg(source: string, target: string, quality: number): Promise<void> {
  const { dlopen, ptr, read, toArrayBuffer } = await import("bun:ffi")
  const library = dlopen(slimgDllPath(), {
    slimg_decode_file: { args: ["ptr"], returns: "ptr" },
    slimg_convert: { args: ["ptr", "u64", "u32", "u32", "i32", "u8"], returns: "ptr" },
    slimg_free_buffer_ptr: { args: ["ptr"], returns: "void" },
  })
  let decodedPointer: Pointer | null = null
  let convertedPointer: Pointer | null = null
  try {
    const path = Buffer.from(`${source}\0`, "utf8")
    decodedPointer = library.symbols.slimg_decode_file(ptr(path))
    if (!decodedPointer) throw new Error("slimg could not decode the source image.")
    const decoded = copyBuffer(decodedPointer, read, toArrayBuffer)
    library.symbols.slimg_free_buffer_ptr(decodedPointer)
    decodedPointer = null
    convertedPointer = library.symbols.slimg_convert(ptr(decoded.data), BigInt(decoded.data.byteLength), decoded.width, decoded.height, AVIF_FORMAT, Math.max(0, Math.min(100, Math.round(quality))))
    if (!convertedPointer) throw new Error("slimg could not encode the AVIF image.")
    const encoded = copyBuffer(convertedPointer, read, toArrayBuffer)
    await writeFile(target, encoded.data)
  } finally {
    if (convertedPointer) library.symbols.slimg_free_buffer_ptr(convertedPointer)
    if (decodedPointer) library.symbols.slimg_free_buffer_ptr(decodedPointer)
    library.close()
  }
}

function slimgDllPath() { return process.env.SLIMG_CFFI_PATH?.trim() || DEFAULT_SLIMG_DLL }

function copyBuffer(
  bufferPointer: import("bun:ffi").Pointer,
  read: typeof import("bun:ffi").read,
  toArrayBuffer: typeof import("bun:ffi").toArrayBuffer,
) {
  const dataPointer = read.ptr(bufferPointer, 0) as import("bun:ffi").Pointer
  const length = Number(read.u64(bufferPointer, 8))
  if (!dataPointer || !Number.isSafeInteger(length) || length <= 0) throw new Error("slimg returned an invalid image buffer.")
  return {
    data: new Uint8Array(toArrayBuffer(dataPointer, 0, length)).slice(),
    width: read.u32(bufferPointer, 16),
    height: read.u32(bufferPointer, 20),
  }
}
