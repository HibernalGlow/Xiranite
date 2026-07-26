import { access, writeFile } from "node:fs/promises"
import type { Pointer } from "bun:ffi"
import type { XlchemyToolStatus } from "./core.js"

const DEFAULT_SLIMG_DLL = "C:\\Windows\\System32\\slimg_cffi.dll"
const AVIF_FORMAT = 3

export async function probeSlimgCffi(): Promise<XlchemyToolStatus> {
  const path = slimgDllPath()
  try {
    await access(path)
  } catch {
    return { id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF encoding", path, available: false, runnable: false, detail: "DLL not found." }
  }
  try {
    const { dlopen } = await import("bun:ffi")
    const library = dlopen(path, { slimg_format_can_encode: { args: ["i32"], returns: "i32" } })
    try {
      const runnable = library.symbols.slimg_format_can_encode(AVIF_FORMAT) === 1
      return {
        id: "slimg-cffi",
        label: "slimg CFFI",
        purpose: "slimg DLL AVIF encoding",
        path,
        available: true,
        runnable,
        detail: runnable ? "DLL loaded with AVIF encoding support." : "DLL loaded, but AVIF encoding is unavailable.",
      }
    } finally {
      library.close()
    }
  } catch (error) {
    return { id: "slimg-cffi", label: "slimg CFFI", purpose: "slimg DLL AVIF encoding", path, available: true, runnable: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

export async function convertWithSlimgCffi(source: string, target: string, quality: number): Promise<void> {
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
    const decodedData = read.ptr(decodedPointer, 0) as Pointer
    const decodedLength = Number(read.u64(decodedPointer, 8))
    const width = read.u32(decodedPointer, 16)
    const height = read.u32(decodedPointer, 20)
    if (!decodedData || !Number.isSafeInteger(decodedLength) || decodedLength <= 0) throw new Error("slimg returned an invalid decoded image buffer.")
    convertedPointer = library.symbols.slimg_convert(decodedData, BigInt(decodedLength), width, height, AVIF_FORMAT, Math.max(0, Math.min(100, Math.round(quality))))
    if (!convertedPointer) throw new Error("slimg could not encode the AVIF image.")
    const encodedData = read.ptr(convertedPointer, 0) as Pointer
    const encodedLength = Number(read.u64(convertedPointer, 8))
    if (!encodedData || !Number.isSafeInteger(encodedLength) || encodedLength <= 0) throw new Error("slimg returned an invalid encoded image buffer.")
    await writeFile(target, new Uint8Array(toArrayBuffer(encodedData, 0, encodedLength)))
  } finally {
    if (convertedPointer) library.symbols.slimg_free_buffer_ptr(convertedPointer)
    if (decodedPointer) library.symbols.slimg_free_buffer_ptr(decodedPointer)
    library.close()
  }
}

function slimgDllPath() {
  return process.env.SLIMG_CFFI_PATH?.trim() || DEFAULT_SLIMG_DLL
}
