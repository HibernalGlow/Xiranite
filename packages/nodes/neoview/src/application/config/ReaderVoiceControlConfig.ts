import { READER_INPUT_ACTIONS, type ReaderInputAction } from "../../domain/input/ReaderInputActions.js"

export interface ReaderVoiceControlConfig {
  enabled: boolean
  language: string
  minConfidence: number
  continuous: boolean
  commands: Partial<Record<ReaderInputAction, readonly string[]>>
}

export interface NeoviewVoiceControlPatch { voiceControl: Partial<ReaderVoiceControlConfig> }

export const DEFAULT_READER_VOICE_CONTROL_CONFIG: ReaderVoiceControlConfig = {
  enabled: false,
  language: "zh-CN",
  minConfidence: 0.6,
  continuous: false,
  commands: {},
}

const actions = new Set<string>(READER_INPUT_ACTIONS)
export function parseReaderVoiceControlConfig(value: unknown, label = "[nodes.neoview.voice_control]"): ReaderVoiceControlConfig {
  if (value === undefined) return clone(DEFAULT_READER_VOICE_CONTROL_CONFIG)
  const record = requireRecord(value, label)
  rejectUnknown(record, ["enabled", "language", "min_confidence", "minConfidence", "continuous", "commands"], label)
  return {
    enabled: record.enabled === undefined ? false : boolean(record.enabled, `${label}.enabled`),
    language: record.language === undefined ? "zh-CN" : language(record.language, `${label}.language`),
    minConfidence: record.min_confidence === undefined && record.minConfidence === undefined ? 0.6 : confidence(record.min_confidence ?? record.minConfidence, `${label}.min_confidence`),
    continuous: record.continuous === undefined ? false : boolean(record.continuous, `${label}.continuous`),
    commands: parseCommands(record.commands, `${label}.commands`),
  }
}

export function parseReaderVoiceControlPatch(value: unknown): { patch: NeoviewVoiceControlPatch; tomlPatch: Record<string, unknown> } {
  const root = requireRecord(value, "reader voice control patch")
  rejectUnknown(root, ["voiceControl"], "reader voice control patch")
  const source = requireRecord(root.voiceControl, "reader voice control patch.voiceControl")
  rejectUnknown(source, ["enabled", "language", "minConfidence", "continuous", "commands"], "reader voice control patch.voiceControl")
  if (!Object.keys(source).length) throw new Error("reader voice control patch must change at least one field.")
  const patch: Partial<ReaderVoiceControlConfig> = {}, toml: Record<string, unknown> = {}
  if (source.enabled !== undefined) patch.enabled = toml.enabled = boolean(source.enabled, "reader voice control patch.enabled")
  if (source.language !== undefined) patch.language = toml.language = language(source.language, "reader voice control patch.language")
  if (source.minConfidence !== undefined) patch.minConfidence = toml.min_confidence = confidence(source.minConfidence, "reader voice control patch.minConfidence")
  if (source.continuous !== undefined) patch.continuous = toml.continuous = boolean(source.continuous, "reader voice control patch.continuous")
  if (source.commands !== undefined) patch.commands = toml.commands = parseCommands(source.commands, "reader voice control patch.commands")
  return { patch: { voiceControl: patch }, tomlPatch: { voice_control: toml } }
}

function parseCommands(value: unknown, label: string): Partial<Record<ReaderInputAction, readonly string[]>> {
  if (value === undefined) return {}
  const record = requireRecord(value, label), output: Partial<Record<ReaderInputAction, readonly string[]>> = {}
  for (const [action, phrases] of Object.entries(record)) {
    if (!actions.has(action)) throw new Error(`${label} contains unsupported Reader action '${action}'.`)
    if (!Array.isArray(phrases) || phrases.length > 32) throw new Error(`${label}.${action} must contain at most 32 phrases.`)
    const unique = [...new Set(phrases.map((phrase) => {
      if (typeof phrase !== "string" || !(phrase = phrase.trim()) || phrase.length > 80) throw new Error(`${label}.${action} contains an invalid phrase.`)
      return phrase
    }))]
    output[action as ReaderInputAction] = unique
  }
  return output
}
function clone(value: ReaderVoiceControlConfig): ReaderVoiceControlConfig { return { ...value, commands: { ...value.commands } } }
function requireRecord(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown> }
function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], label: string) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}.`) }
function boolean(value: unknown, label: string): boolean { if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`); return value }
function language(value: unknown, label: string): string { if (typeof value !== "string" || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(value)) throw new Error(`${label} must be a BCP-47 language tag.`); return value }
function confidence(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1.`); return value }
