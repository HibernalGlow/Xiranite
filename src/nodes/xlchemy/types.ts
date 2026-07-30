import type { XlchemyAction, XlchemyData, XlchemyDownscaleMode, XlchemyFilenameRule, XlchemyFormat, XlchemyOutputMode, XlchemyToolStatus } from "@xiranite/node-xlchemy/core"
import type { XlchemyClipboardCopyMode } from "./clipboard-output"

export type XlchemyPhase = "idle" | "running" | "completed" | "cancelled" | "error"

export interface XlchemyEfuAnalysis {
  totalFiles: number
  totalSize: number
  minSize: number
  medianSize: number
  maxSize: number
  formats: Array<{ key: string; count: number; size: number }>
  folders: Array<{ key: string; count: number; size: number }>
}

export interface XlchemyCardState {
  action?: XlchemyAction
  pathsText?: string
  /** Directory roots stay as source descriptors and are enumerated only by the backend. */
  inputDirectoryPaths?: string[]
  /** Native EFU paths are streamed by the backend instead of expanded into card state. */
  efuFiles?: string[]
  /** Fixed-size summaries used by input analysis; individual EFU rows stay out of React state. */
  efuAnalysisByPath?: Record<string, XlchemyEfuAnalysis>
  format?: XlchemyFormat
  lossless?: boolean
  quality?: number
  clipboardFormat?: XlchemyFormat
  clipboardLossless?: boolean
  clipboardQuality?: number
  clipboardOutputMode?: XlchemyOutputMode
  clipboardOutputDir?: string
  clipboardAutoCopy?: boolean
  clipboardCopyMode?: XlchemyClipboardCopyMode
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
  skipAnimatedImages?: boolean
  detectAnimatedPng?: boolean
  detectAnimatedWebp?: boolean
  detectAnimatedAvif?: boolean
  detectAnimatedJxl?: boolean
  smallestPng?: boolean
  smallestWebp?: boolean
  smallestJxl?: boolean
  jpegEncoder?: "jpegli" | "libjpeg"
  avifEncoder?: "aom" | "svt" | "slimg"
  slimgBackend?: "dll" | "cli"
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
  processedCount?: number
  runInputCount?: number
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

export const XL_CONFIG_FIELDS = ["format", "lossless", "quality", "clipboardFormat", "clipboardLossless", "clipboardQuality", "clipboardOutputMode", "clipboardOutputDir", "clipboardAutoCopy", "clipboardCopyMode", "effort", "maxCompression", "threads", "outputMode", "outputDir", "preserveMetadata", "preserveStructure", "preserveTimestamps", "overwrite", "recursive", "existingPolicy", "deleteOriginal", "deleteOriginalMode", "intelligentEffort", "jxlModular", "jxlVerify", "jxlPngFallback", "jxlNormalize", "jxlNormalizeWhen", "chromaSubsampling", "metadataMode", "keepIfLarger", "copyIfLarger", "skipAnimatedImages", "detectAnimatedPng", "detectAnimatedWebp", "detectAnimatedAvif", "detectAnimatedJxl", "smallestPng", "smallestWebp", "smallestJxl", "jpegEncoder", "avifEncoder", "slimgBackend", "avifBitDepth", "avifAomIqTune", "disableProgressiveJpegli", "autoLosslessJpeg", "qualityPrecisionSnapping", "disableSorting", "disableDownscalingStartup", "disableDeleteStartup", "enableCustomArgs", "cjxlArgs", "avifencArgs", "cjpegliArgs", "imageMagickArgs", "ramOptimizer", "ramOptimizerRules", "playSoundOnFinish", "playSoundVolume", "autoClearCompleted", "exiftoolWipeArgs", "exiftoolPreserveArgs", "exiftoolUnsafeWipeArgs", "exiftoolCustomArgs", "processingOrder", "excludedFormatsText", "downscaleEnabled", "downscaleMode", "downscaleWidth", "downscaleHeight", "downscalePercent", "downscaleFileSizeKb", "downscaleShortestSide", "downscaleLongestSide", "downscaleMegapixels", "downscaleResample", "showProgressCounter", "showProgressSummary", "showProgressEta", "showProgressFormat", "showProgressEncoder", "showRawProgress", "showProgressCurrentFile", "showProgressSizeChange", "selectedPreset"] as const satisfies Array<keyof XlchemyCardState>
export const XL_FILENAME_CONFIG_FIELDS = ["filenameRules"] as const satisfies Array<keyof XlchemyCardState>
