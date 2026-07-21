import type { ReaderPage } from "../page/page.js"

const NATIVE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const NATIVE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "jpe", "webp"])

export function isNativeSuperResolutionInput(page: Pick<ReaderPage, "mimeType" | "name" | "sourcePath">): boolean {
  const mimeType = page.mimeType?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US")
  if (mimeType) return NATIVE_MIME_TYPES.has(mimeType)
  const candidate = page.name || page.sourcePath
  const dot = candidate.lastIndexOf(".")
  return dot >= 0 && NATIVE_EXTENSIONS.has(candidate.slice(dot + 1).toLocaleLowerCase("en-US"))
}
