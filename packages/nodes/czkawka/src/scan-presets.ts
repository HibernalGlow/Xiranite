import { CZKAWKA_TOOLS, type CzkawkaInput, type CzkawkaTool } from "./core.js"
import { CZKAWKA_TOOL_OPTIONS, createCzkawkaScanInput } from "./tool-options.js"

export interface CzkawkaScanPreset {
  version: 1
  id: string
  name: string
  tool: CzkawkaTool
  input: CzkawkaInput
  createdAt: number
  updatedAt: number
}

export interface CzkawkaScanPresetDocument {
  schema: "xiranite.czkawka.scan-presets"
  version: 1
  presets: CzkawkaScanPreset[]
}

export function saveCzkawkaScanPreset(presets: CzkawkaScanPreset[], options: { id?: string; name: string; input: CzkawkaInput; now?: number; createId?: () => string }): { presets: CzkawkaScanPreset[]; preset: CzkawkaScanPreset } {
  const name = options.name.trim()
  if (!name) throw new Error("Preset name is required.")
  const now = options.now ?? Date.now()
  const existing = options.id ? presets.find((preset) => preset.id === options.id) : undefined
  const preset: CzkawkaScanPreset = {
    version: 1,
    id: existing?.id ?? options.createId?.() ?? createPresetId(),
    name,
    tool: normalizeTool(options.input.tool),
    input: canonicalScanInput(options.input),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return { preset, presets: existing ? presets.map((item) => item.id === existing.id ? preset : item) : [...presets, preset] }
}

export function deleteCzkawkaScanPreset(presets: CzkawkaScanPreset[], id: string): CzkawkaScanPreset[] { return presets.filter((preset) => preset.id !== id) }

export function exportCzkawkaScanPresets(presets: CzkawkaScanPreset[]): string {
  const document: CzkawkaScanPresetDocument = { schema: "xiranite.czkawka.scan-presets", version: 1, presets: presets.map(validatePreset) }
  return `${JSON.stringify(document, null, 2)}\n`
}

export function importCzkawkaScanPresets(text: string, existing: CzkawkaScanPreset[] = [], mode: "merge" | "replace" = "merge"): CzkawkaScanPreset[] {
  if (text.length > 1_000_000) throw new Error("Preset document is too large.")
  const value = JSON.parse(text) as Partial<CzkawkaScanPresetDocument>
  if (value.schema !== "xiranite.czkawka.scan-presets" || value.version !== 1 || !Array.isArray(value.presets)) throw new Error("Unsupported Czkawka preset document.")
  const imported = value.presets.map(validatePreset)
  if (mode === "replace") return imported
  const merged = new Map(existing.map((preset) => [preset.id, validatePreset(preset)]))
  for (const preset of imported) merged.set(preset.id, preset)
  return [...merged.values()]
}

/** Maps a canonical preset back to the shared GUI/CLI/TUI interaction field names. */
export function czkawkaScanPresetToValues(preset: CzkawkaScanPreset): Record<string, unknown> {
  const input = canonicalScanInput(preset.input)
  const values: Record<string, unknown> = {
    tool: preset.tool,
    includedDirectoriesText: input.includedDirectories?.join("\n") ?? "",
    includedDirectoriesReferencedText: input.includedDirectoriesReferenced?.join("\n") ?? "",
    excludedDirectoriesText: input.excludedDirectories?.join("\n") ?? "",
    excludedItemsText: input.excludedItems?.join("; ") ?? "",
    allowedExtensions: input.allowedExtensions ?? "",
    excludedExtensions: input.excludedExtensions ?? "",
    minimumFileSize: input.minimumFileSize === undefined ? "" : String(input.minimumFileSize),
    maximumFileSize: input.maximumFileSize === undefined ? "" : String(input.maximumFileSize),
    recursive: input.recursive ?? true,
    useCache: input.useCache ?? true,
  }
  for (const option of CZKAWKA_TOOL_OPTIONS) if (input[option.id] !== undefined) values[option.id] = typeof option.defaultValue === "number" ? String(input[option.id]) : input[option.id]
  return values
}

export function czkawkaScanPresetFromValues(name: string, values: Record<string, unknown>, options: { id?: string; presets?: CzkawkaScanPreset[]; now?: number; createId?: () => string } = {}) {
  return saveCzkawkaScanPreset(options.presets ?? [], { ...options, name, input: createCzkawkaScanInput(normalizeTool(values.tool), values) })
}

function canonicalScanInput(input: CzkawkaInput): CzkawkaInput {
  const blocked = new Set(["selectedPaths", "destinationDirectory", "destinationItems", "renameItems", "deleteMode", "copyMode", "preserveStructure", "conflictPolicy", "outputPath", "outputFormat", "exportScope", "exportEntries", "dryRun"])
  return Object.fromEntries(Object.entries({ ...input, action: "scan", tool: normalizeTool(input.tool) }).filter(([key, value]) => !blocked.has(key) && value !== undefined)) as CzkawkaInput
}

function validatePreset(value: unknown): CzkawkaScanPreset {
  if (!value || typeof value !== "object") throw new Error("Invalid Czkawka preset.")
  const preset = value as Partial<CzkawkaScanPreset>
  if (preset.version !== 1 || typeof preset.id !== "string" || !preset.id.trim() || typeof preset.name !== "string" || !preset.name.trim() || typeof preset.createdAt !== "number" || typeof preset.updatedAt !== "number" || !preset.input || typeof preset.input !== "object") throw new Error("Invalid Czkawka preset.")
  return { version: 1, id: preset.id.trim(), name: preset.name.trim(), tool: normalizeTool(preset.tool), input: canonicalScanInput(preset.input), createdAt: preset.createdAt, updatedAt: preset.updatedAt }
}

function normalizeTool(value: unknown): CzkawkaTool { return CZKAWKA_TOOLS.includes(value as CzkawkaTool) ? value as CzkawkaTool : "duplicate-files" }
function createPresetId(): string { return globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
