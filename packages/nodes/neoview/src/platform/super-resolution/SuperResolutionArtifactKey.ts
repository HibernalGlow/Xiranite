import { createHash } from "node:crypto"

export interface SuperResolutionArtifactKeyInput {
  sourceIdentity: string
  sourceRevision: string
  pageIdentity: string
  modelId: string
  scale: number
  noise?: number
  tileSize?: number
  tta?: boolean
  producerVersion: string
}

const SCHEMA_VERSION = 1

export function buildSuperResolutionArtifactKey(input: SuperResolutionArtifactKeyInput): string {
  for (const name of ["sourceIdentity", "sourceRevision", "pageIdentity", "modelId", "producerVersion"] as const) {
    if (!input[name]) throw new TypeError(`${name} must be a non-empty string`)
  }
  if (!Number.isSafeInteger(input.scale) || input.scale <= 0) throw new RangeError("scale must be a positive integer")
  const digest = createHash("sha256").update(JSON.stringify([
    SCHEMA_VERSION,
    input.sourceIdentity,
    input.sourceRevision,
    input.pageIdentity,
    input.modelId,
    input.scale,
    input.noise ?? null,
    input.tileSize ?? null,
    input.tta ?? false,
    input.producerVersion,
  ])).digest("base64url")
  return `neoview:super-resolution:v${SCHEMA_VERSION}:${digest}`
}
