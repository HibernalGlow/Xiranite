export type SuperResolutionEngine = "upscayl" | "waifu2x" | "realcugan"
export type SuperResolutionModelType = "upscale" | "descreen" | "artifact-removal"

export interface SuperResolutionCustomModelManifest {
  id: string
  type: SuperResolutionModelType
  displayName: string
  engine: SuperResolutionEngine
  scales: readonly number[]
  noise?: readonly number[]
  latency?: number
  modelDirectory: string
  modelFiles: readonly string[]
  scaleFiles?: Readonly<Record<number, string>>
  license: string
  checksums: Readonly<Record<string, string>>
  inputBlob: string
  outputBlob: string
  downloadBaseUrl?: string
}

export interface SuperResolutionModelManifest {
  id: string
  displayName: string
  engine: SuperResolutionEngine
  scales: readonly number[]
  modelDirectory?: string
  modelFiles?: readonly string[]
  inputBlob?: string
  outputBlob?: string
  license?: string
  checksums?: Readonly<Record<string, string>>
}

export interface SuperResolutionEngineCapability {
  engine: SuperResolutionEngine
  available: boolean
  executablePath?: string
  version?: string
  architecture?: string
  daemonSupported?: boolean
  reason?: string
}

export interface SuperResolutionCapabilitySnapshot {
  engines: readonly SuperResolutionEngineCapability[]
  probedAt: number
}

export interface SuperResolutionRequest {
  sourcePath: string
  destinationPath: string
  model: SuperResolutionModelManifest
  scale: number
  noise?: number
  tileSize?: number
  tta?: boolean
  gpuId?: string
}

export interface SuperResolutionProgress {
  completed: number
  message?: string
}

export interface SuperResolutionResult {
  sourcePath: string
  destinationPath: string
  modelId: string
  engine: SuperResolutionEngine
  scale: number
  width?: number
  height?: number
  elapsedMs: number
}

export interface SuperResolutionExecutionContext {
  signal?: AbortSignal
  onProgress?: (progress: SuperResolutionProgress) => void
}

export interface SuperResolutionProvider {
  capabilities(signal?: AbortSignal): Promise<SuperResolutionCapabilitySnapshot>
  upscale(request: SuperResolutionRequest, context?: SuperResolutionExecutionContext): Promise<SuperResolutionResult>
  dispose?(): void | Promise<void>
}
