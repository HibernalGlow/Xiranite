export type XlchemyAction = "plan" | "convert"
export type XlchemyFormat = "JPEG XL" | "AVIF" | "WebP" | "PNG" | "TIFF" | "JPEG"
export type XlchemyOutputMode = "source" | "directory"

export interface XlchemyInput {
  action?: XlchemyAction
  paths: string[]
  format: XlchemyFormat
  lossless: boolean
  quality: number
  effort: number
  threads: number
  outputMode: XlchemyOutputMode
  outputDir?: string
  preserveMetadata: boolean
  preserveStructure: boolean
  overwrite: boolean
  recursive: boolean
}

export interface XlchemyFileResult {
  sourcePath: string
  outputPath: string
  sourceBytes?: number
  outputBytes?: number
  status: "planned" | "converted" | "skipped" | "error"
  error?: string
}

export interface XlchemyData {
  files: XlchemyFileResult[]
  inputCount: number
  convertedCount: number
  skippedCount: number
  errorCount: number
  inputBytes: number
  outputBytes: number
  elapsedMs?: number
  errors: string[]
}

export interface XlchemyRuntime {}

export async function runXlchemy(): Promise<{ success: false; message: string }> {
  return {
    success: false,
    message: "Xlchemy GUI is ready; the native conversion runtime has not been connected yet.",
  }
}

export function normalizeXlchemyInput(input: Partial<XlchemyInput>): XlchemyInput {
  return {
    action: input.action ?? "plan",
    paths: [...new Set((input.paths ?? []).map((path) => path.trim()).filter(Boolean))],
    format: input.format ?? "JPEG XL",
    lossless: input.lossless ?? false,
    quality: clamp(input.quality ?? 90, 1, 100),
    effort: clamp(input.effort ?? 7, 1, 10),
    threads: clamp(input.threads ?? 4, 1, 64),
    outputMode: input.outputMode ?? "source",
    outputDir: input.outputDir?.trim() || undefined,
    preserveMetadata: input.preserveMetadata ?? true,
    preserveStructure: input.preserveStructure ?? true,
    overwrite: input.overwrite ?? false,
    recursive: input.recursive ?? true,
  }
}

export function compressionRatio(data: Pick<XlchemyData, "inputBytes" | "outputBytes">): number {
  if (data.inputBytes <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - data.outputBytes / data.inputBytes) * 1000) / 10))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
