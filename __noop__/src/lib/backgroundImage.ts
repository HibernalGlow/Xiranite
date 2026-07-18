import { localBackendFileUrl } from "@/backend/localBackendConfig"

export function normalizePersistedBackgroundImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || isTransientBackgroundImageUrl(trimmed)) return undefined
  return trimmed
}

export function sanitizePersistedBackgroundImageUrl(value: string): string {
  return normalizePersistedBackgroundImageUrl(value) ?? ""
}

export function toBackgroundImageCssUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (isLocalFilePath(trimmed)) {
    try {
      return localBackendFileUrl(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

export function isTransientBackgroundImageUrl(value: string): boolean {
  return value.startsWith("blob:")
}

export function localPathFromFile(file: File): string | undefined {
  const maybePath = (file as File & { path?: unknown }).path
  return typeof maybePath === "string" && maybePath.trim() ? maybePath.trim() : undefined
}

function isLocalFilePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")
}
