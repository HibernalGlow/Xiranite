import type { XlchemyAction, XlchemyData, XlchemyDownscaleMode, XlchemyFilenameRule, XlchemyFormat, XlchemyOutputMode, XlchemyToolStatus } from "@xiranite/node-xlchemy/core"

export type XlchemyPhase = "idle" | "running" | "completed" | "cancelled" | "error"

export interface XlchemyCardState {
  action?: XlchemyAction
  pathsText?: string
  format?: XlchemyFormat
  lossless?: boolean
  quality?: number
  effort?: number
  maxCompression?: boolean
  threads?: number
  outputMode?: XlchemyOutputMode
  outputDir?: string
  filenameRules?: XlchemyFilenameRule[]
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
  metadataMode?: "encoder-wipe" | "encoder-preserve" | "exiftool-wipe" | "exiftool-preserve" | "exiftool-unsafe-wipe" | "exiftool-custom"
  keepIfLarger?: boolean
  copyIfLarger?: boolean
  smallestPng?: boolean
  smallestWebp?: boolean
  smallestJxl?: boolean
  jpegEncoder?: "jpegli" | "libjpeg"
  avifEncoder?: "aom" | "svt" | "slimg"
  avifBitDepth?: "auto" | "8" | "10" | "12"
  avifAomIqTune?: boolean
  disableProgressiveJpegli?: boolean
  autoLosslessJpeg?: boolean
  qualityPrecisionSnapping?: boolean
  disableSorting?: boolean
  disableDownscalingStartup?: boolean
  disableDeleteStartup?: boolean
  enableCustomArgs?: boolean
  cjxlArgs?: string
  avifencArgs?: string
  cjpegliArgs?: string
  imageMagickArgs?: string
  ramOptimizer?: "dynamic" | "static" | "disabled"
  ramOptimizerRules?: string
  playSoundOnFinish?: boolean
  playSoundVolume?: number
  autoClearCompleted?: boolean
  exiftoolWipeArgs?: string
  exiftoolPreserveArgs?: string
  exiftoolUnsafeWipeArgs?: string
  exiftoolCustomArgs?: string
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
  showProgressCurrentFile?: boolean
  showProgressSizeChange?: boolean
  environment?: XlchemyToolStatus[]
  environmentCheckedAt?: string
  settingsTab?: "common" | "conversion" | "files" | "general"
  analysisTab?: "input" | "output"
  resultTab?: "results" | "issues" | "logs"
  result?: XlchemyData | null
}

export interface XlchemyCustomPreset {
  id: string
  name: string
  values: Partial<XlchemyCardState>
}

export const XL_CONFIG_FIELDS = ["format", "lossless", "quality", "effort", "maxCompression", "threads", "outputMode", "outputDir", "preserveMetadata", "preserveStructure", "preserveTimestamps", "overwrite", "recursive", "existingPolicy", "deleteOriginal", "deleteOriginalMode", "intelligentEffort", "jxlModular", "jxlVerify", "jxlPngFallback", "jxlNormalize", "jxlNormalizeWhen", "chromaSubsampling", "metadataMode", "keepIfLarger", "copyIfLarger", "smallestPng", "smallestWebp", "smallestJxl", "jpegEncoder", "avifEncoder", "avifBitDepth", "avifAomIqTune", "disableProgressiveJpegli", "autoLosslessJpeg", "qualityPrecisionSnapping", "disableSorting", "disableDownscalingStartup", "disableDeleteStartup", "enableCustomArgs", "cjxlArgs", "avifencArgs", "cjpegliArgs", "imageMagickArgs", "ramOptimizer", "ramOptimizerRules", "playSoundOnFinish", "playSoundVolume", "autoClearCompleted", "exiftoolWipeArgs", "exiftoolPreserveArgs", "exiftoolUnsafeWipeArgs", "exiftoolCustomArgs", "processingOrder", "excludedFormatsText", "downscaleEnabled", "downscaleMode", "downscaleWidth", "downscaleHeight", "downscalePercent", "downscaleFileSizeKb", "downscaleShortestSide", "downscaleLongestSide", "downscaleMegapixels", "downscaleResample", "showProgressCounter", "showProgressSummary", "showProgressEta", "showProgressFormat", "showProgressEncoder", "showRawProgress", "showProgressCurrentFile", "showProgressSizeChange", "selectedPreset"] as const satisfies Array<keyof XlchemyCardState>
export const XL_FILENAME_CONFIG_FIELDS = ["filenameRules"] as const satisfies Array<keyof XlchemyCardState>
