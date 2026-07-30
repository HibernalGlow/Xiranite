import { COMFYGURE_PROFILE_FORMAT } from "./contracts.js"
import type { ComfygureProfile, ComfygureProfileProgram, ComfygureProfileSummary, ComfygureProgram, ComfygureProgramDraft } from "./contracts.js"
import { stringValue, rounded, isRecord } from "./value-normalization.js"
import { normalizeComfygureProgram } from "./program-normalization.js"

export function createComfygureProfile(
  input: ComfygureProgramDraft | ComfygureProgram,
  name: string,
  options: { id?: string; previous?: ComfygureProfile; now?: Date } = {},
): ComfygureProfile {
  const now = (options.now ?? new Date()).toISOString()
  const previous = options.previous
  const normalizedName = stringValue(name, previous?.name || "Comfygure profile")
  const id = normalizeProfileId(options.id ?? previous?.id ?? normalizedName)
  const program = normalizeComfygureProgram(input)
  return {
    format: COMFYGURE_PROFILE_FORMAT,
    schemaVersion: 1,
    id,
    name: normalizedName,
    revision: previous ? previous.revision + 1 : 1,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    program: profileProgramFrom(program),
  }
}
export function normalizeComfygureProfile(value: unknown): ComfygureProfile | undefined {
  if (!isRecord(value)) return undefined
  const id = normalizeProfileId(stringValue(value.id, ""))
  const name = stringValue(value.name, "")
  const rawProgram = isRecord(value.program) ? value.program as ComfygureProgramDraft : undefined
  if (!id || !name || !rawProgram) return undefined
  const revision = rounded(value.revision, 1, 1, Number.MAX_SAFE_INTEGER)
  const createdAt = isoTimestamp(value.createdAt) ?? new Date(0).toISOString()
  const updatedAt = isoTimestamp(value.updatedAt) ?? createdAt
  return {
    format: COMFYGURE_PROFILE_FORMAT,
    schemaVersion: 1,
    id,
    name,
    revision,
    createdAt,
    updatedAt,
    program: profileProgramFrom(normalizeComfygureProgram(rawProgram)),
  }
}
export function resolveComfygureProfile(profile: ComfygureProfile, overrides: ComfygureProgramDraft = {}): ComfygureProgram {
  return normalizeComfygureProgram({
    ...profile.program,
    ...overrides,
    model: { ...profile.program.model, ...overrides.model },
    loras: overrides.loras ?? profile.program.loras,
    rules: overrides.rules ?? profile.program.rules,
    parameters: { ...profile.program.parameters, ...overrides.parameters },
    teaCache: { ...profile.program.teaCache, ...overrides.teaCache },
    output: { ...profile.program.output, ...overrides.output },
  })
}
export function summarizeComfygureProfile(profile: ComfygureProfile): ComfygureProfileSummary {
  return { id: profile.id, name: profile.name, revision: profile.revision, updatedAt: profile.updatedAt }
}
export function profileProgramFrom(program: ComfygureProgram): ComfygureProfileProgram {
  return {
    model: { ...program.model },
    loras: program.loras.map((lora) => ({ ...lora })),
    rules: program.rules.map((rule) => ({
      ...rule,
      when: structuredClone(rule.when),
      effects: rule.effects.map((effect) => ({ ...effect, payload: { ...effect.payload } })),
    })),
    parameters: { ...program.parameters },
    teaCache: { ...program.teaCache },
    output: { ...program.output },
  }
}
export function normalizeProfileId(value: unknown): string {
  if (typeof value !== "string") return ""
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized.slice(0, 96)
}
export function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString()
}
