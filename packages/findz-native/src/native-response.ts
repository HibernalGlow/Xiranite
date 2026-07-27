export type FindzNativePointer = unknown

export interface FindzNativeResponseReader {
  toArrayBuffer(pointer: FindzNativePointer, byteOffset: number, length: number): ArrayBuffer
}

export interface FindzNativeResponseReleaser {
  findz_free(response: FindzNativePointer): void
}

export function readFindzNativeResponse(
  ffi: FindzNativeResponseReader,
  symbols: FindzNativeResponseReleaser,
  responsePointer: FindzNativePointer,
  responseLength: BigUint64Array,
): string {
  if (!responsePointer) throw new Error("Findz native core returned an empty response pointer.")
  try {
    const length = Number(responseLength[0])
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new Error("Findz native core returned an invalid response length.")
    }
    return new TextDecoder().decode(ffi.toArrayBuffer(responsePointer, 0, length))
  } finally {
    symbols.findz_free(responsePointer)
  }
}
