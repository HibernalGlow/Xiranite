import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate"
import type { ComfygureCompressedText } from "./contracts.js"

export function compressComfygureText(value: string): ComfygureCompressedText | undefined {
  const normalized = value.replace(/\r\n?/g, "\n")
  if (!normalized) return undefined
  return {
    format: "deflate-base64/v1",
    data: bytesToBase64(deflateSync(strToU8(normalized), { level: 6 })),
    lineCount: normalized.split("\n").length,
    uncompressedLength: normalized.length,
  }
}
export function decompressComfygureText(value: ComfygureCompressedText | undefined): string {
  if (!value || value.format !== "deflate-base64/v1" || !value.data) return ""
  try {
    return strFromU8(inflateSync(base64ToBytes(value.data)))
  } catch {
    return ""
  }
}
export function bytesToBase64(value: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ""
  for (let index = 0; index < value.length; index += chunkSize) binary += String.fromCharCode(...value.subarray(index, index + chunkSize))
  return btoa(binary)
}
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
