import type { ComfygureLora, ComfygureProgram, ComfyuiPromptHistory, ComfyuiSubmission, PreflightReport } from "@xiranite/node-comfygure/core"

export interface ComfygureTargetConfig {
  endpoint?: string
  libraryPath?: string
}

export interface ComfygureCardPreview {
  graphNodeCount: number
  generationJobCount: number
  activeLoraNames: readonly string[]
  positivePrompt: string
  negativePrompt: string
}

export interface ComfygureCardState {
  program?: ComfygureProgram
  preview?: ComfygureCardPreview
  preflight?: PreflightReport
  submission?: ComfyuiSubmission
  submissions?: readonly ComfyuiSubmission[]
  history?: readonly ComfyuiPromptHistory[]
  status?: string
  progress?: number
}

export function parseLoraRows(value: string): ComfygureLora[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return []
    const [name = "", modelStrength = "1", clipStrength = "1", activationTerms = "", injectionTerms = ""] = trimmed.split("|").map((part) => part.trim())
    if (!name) return []
    return [{
      name,
      modelStrength: numberValue(modelStrength, 1),
      clipStrength: numberValue(clipStrength, 1),
      activationTerms,
      injectionTerms,
      enabled: true,
    }]
  })
}

export function formatLoraRows(loras: readonly ComfygureLora[]): string {
  return loras.map((lora) => [
    lora.name,
    lora.modelStrength ?? 1,
    lora.clipStrength ?? 1,
    lora.activationTerms ?? "",
    lora.injectionTerms ?? "",
  ].join(" | ")).join("\n")
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
