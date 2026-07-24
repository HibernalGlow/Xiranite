import type { ComfygureCompressedText, ComfygureControlOptions, ComfygureProfile, ComfygureProfileSummary, ComfygureProgram, ComfygureTemplate, ComfygureWorkflowDiagnostic, ComfyuiPromptHistory, ComfyuiSubmission, PreflightReport } from "@xiranite/node-comfygure/core"

export interface ComfygureTargetConfig {
  endpoint?: string
  libraryPath?: string
  profileLibraryPath?: string
  lastProfileId?: string
}

export interface ComfygureCardPreview {
  graphNodeCount: number
  generationJobCount: number
  activeLoraNames: readonly string[]
  positivePrompt: string
  negativePrompt: string
  filenamePrefix: string
}

export interface ComfygureCardState {
  program?: ComfygureProgram
  batchText?: ComfygureCompressedText
  batchEntryMetadata?: ComfygureCompressedText
  template?: ComfygureTemplate
  templateDiagnostics?: readonly ComfygureWorkflowDiagnostic[]
  profiles?: readonly ComfygureProfileSummary[]
  profile?: ComfygureProfile
  preview?: ComfygureCardPreview
  preflight?: PreflightReport
  controlOptions?: ComfygureControlOptions
  submission?: ComfyuiSubmission
  submissions?: readonly ComfyuiSubmission[]
  history?: readonly ComfyuiPromptHistory[]
  status?: string
  progress?: number
}
