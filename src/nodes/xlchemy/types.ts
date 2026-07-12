import type { XlchemyAction, XlchemyData, XlchemyDownscaleMode, XlchemyFormat, XlchemyOutputMode } from "@xiranite/node-xlchemy/core"

export type XlchemyPhase = "idle" | "running" | "completed" | "cancelled" | "error"

export interface XlchemyCardState {
  action?: XlchemyAction
  pathsText?: string
  format?: XlchemyFormat
  lossless?: boolean
  quality?: number
  effort?: number
  threads?: number
  outputMode?: XlchemyOutputMode
  outputDir?: string
  preserveMetadata?: boolean
  preserveStructure?: boolean
  overwrite?: boolean
  recursive?: boolean
  existingPolicy?: "replace" | "skip" | "rename"
  deleteOriginal?: boolean
  deleteOriginalMode?: "trash" | "permanent"
  preserveTimestamps?: boolean
  intelligentEffort?: boolean
  jxlModular?: boolean
  jxlVerify?: boolean
  jxlPngFallback?: boolean
  jxlNormalize?: boolean
  jxlNormalizeWhen?: "on-fail" | "always"
  chromaSubsampling?: string
  metadataMode?: "encoder-wipe" | "encoder-preserve" | "exiftool-wipe" | "exiftool-preserve" | "exiftool-unsafe-wipe"
  keepIfLarger?: boolean
  copyIfLarger?: boolean
  jpegEncoder?: "jpegli" | "libjpeg"
  avifEncoder?: "aom" | "svt"
  avifBitDepth?: "auto" | "8" | "10" | "12"
  processingOrder?: "original" | "path-asc" | "path-desc" | "size-asc" | "size-desc" | "random" | "sequential"
  excludedFormatsText?: string
  downscaleEnabled?: boolean
  downscaleMode?: XlchemyDownscaleMode
  downscaleWidth?: number
  downscaleHeight?: number
  downscalePercent?: number
  downscaleFileSizeKb?: number
  downscaleShortestSide?: number
  downscaleLongestSide?: number
  downscaleMegapixels?: number
  downscaleResample?: string
  selectedPreset?: string
  selectedPaths?: string[]
  inputViewMode?: "list" | "tree"
  inputSortField?: "name" | "ext" | "size" | "dir"
  inputSortDesc?: boolean
  showOriginalPreview?: boolean
  phase?: XlchemyPhase
  progress?: number
  progressText?: string
  currentFile?: string
  logs?: string[]
  showProgressCounter?: boolean
  showProgressSummary?: boolean
  showProgressEta?: boolean
  showProgressFormat?: boolean
  showProgressEncoder?: boolean
  showRawProgress?: boolean
  result?: XlchemyData | null
}

export const XL_CONFIG_FIELDS = ["format", "lossless", "quality", "effort", "threads", "outputMode", "outputDir", "preserveMetadata", "preserveStructure", "preserveTimestamps", "overwrite", "recursive", "existingPolicy", "deleteOriginal", "deleteOriginalMode", "intelligentEffort", "jxlModular", "jxlVerify", "jxlPngFallback", "jxlNormalize", "jxlNormalizeWhen", "chromaSubsampling", "metadataMode", "keepIfLarger", "copyIfLarger", "jpegEncoder", "avifEncoder", "avifBitDepth", "processingOrder", "excludedFormatsText", "downscaleEnabled", "downscaleMode", "downscaleWidth", "downscaleHeight", "downscalePercent", "downscaleFileSizeKb", "downscaleShortestSide", "downscaleLongestSide", "downscaleMegapixels", "downscaleResample", "selectedPreset"] as const satisfies Array<keyof XlchemyCardState>
