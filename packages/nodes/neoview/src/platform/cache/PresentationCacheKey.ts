import { createHash } from "node:crypto"

export interface PresentationCacheKeyInput {
  cacheKind: "presentation-transform"
  sourceIdentity: string
  sourceRevision: string
  entryIdentity: string
  producerVersion: string
  transformProfile: string
}

const CACHE_KEY_SCHEMA_VERSION = 1
export const SHARP_PRESENTATION_PRODUCER_VERSION = "sharp-0.35.3-jxl"
export const WINDOWS_PRESENTATION_PRODUCER_VERSION = "wic-arcthumb-0.1.0+sharp-0.35.3-jxl"

export function buildPresentationCacheKey(input: PresentationCacheKeyInput): string {
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`)
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([
      CACHE_KEY_SCHEMA_VERSION,
      input.cacheKind,
      input.sourceIdentity,
      input.sourceRevision,
      input.entryIdentity,
      input.producerVersion,
      input.transformProfile,
    ]))
    .digest("base64url")
  return `neoview:presentation:v${CACHE_KEY_SCHEMA_VERSION}:${digest}`
}
