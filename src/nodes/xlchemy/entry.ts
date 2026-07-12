import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-xlchemy"
import { z } from "zod"
import { Component } from "./Component"
import type { XlchemyCardState } from "./types"

const dataSchema = z.object({
  action: z.enum(["plan", "convert", "diagnose"]).optional(),
  pathsText: z.string().optional(),
  format: z.enum(["JPEG XL", "AVIF", "WebP", "PNG", "TIFF", "JPEG", "Lossless JPEG Transcoding", "JPEG Reconstruction", "Smallest Lossless"]).optional(),
  lossless: z.boolean().optional(),
  quality: z.number().optional(),
  effort: z.number().optional(),
  maxCompression: z.boolean().optional(),
  threads: z.number().optional(),
  outputMode: z.enum(["source", "directory"]).optional(),
  outputDir: z.string().optional(),
  preserveMetadata: z.boolean().optional(),
  preserveStructure: z.boolean().optional(),
  overwrite: z.boolean().optional(),
  recursive: z.boolean().optional(),
  existingPolicy: z.enum(["replace", "skip", "rename"]).optional(),
  deleteOriginal: z.boolean().optional(),
  deleteOriginalMode: z.enum(["trash", "permanent"]).optional(),
  preserveTimestamps: z.boolean().optional(),
  intelligentEffort: z.boolean().optional(), jxlModular: z.boolean().optional(), jxlVerify: z.boolean().optional(), jxlPngFallback: z.boolean().optional(), jxlNormalize: z.boolean().optional(), jxlNormalizeWhen: z.enum(["on-fail", "always"]).optional(),
  chromaSubsampling: z.string().optional(), metadataMode: z.enum(["encoder-wipe", "encoder-preserve", "exiftool-wipe", "exiftool-preserve", "exiftool-unsafe-wipe", "exiftool-custom"]).optional(),
  keepIfLarger: z.boolean().optional(), copyIfLarger: z.boolean().optional(), smallestPng: z.boolean().optional(), smallestWebp: z.boolean().optional(), smallestJxl: z.boolean().optional(), jpegEncoder: z.enum(["jpegli", "libjpeg"]).optional(), avifEncoder: z.enum(["aom", "svt", "slimg"]).optional(), avifBitDepth: z.enum(["auto", "8", "10", "12"]).optional(), avifAomIqTune: z.boolean().optional(), disableProgressiveJpegli: z.boolean().optional(), autoLosslessJpeg: z.boolean().optional(), qualityPrecisionSnapping: z.boolean().optional(), disableSorting: z.boolean().optional(), disableDownscalingStartup: z.boolean().optional(), disableDeleteStartup: z.boolean().optional(), enableCustomArgs: z.boolean().optional(), cjxlArgs: z.string().optional(), avifencArgs: z.string().optional(), cjpegliArgs: z.string().optional(), imageMagickArgs: z.string().optional(), ramOptimizer: z.enum(["dynamic", "static", "disabled"]).optional(), ramOptimizerRules: z.string().optional(), playSoundOnFinish: z.boolean().optional(), playSoundVolume: z.number().optional(), autoClearCompleted: z.boolean().optional(), exiftoolWipeArgs: z.string().optional(), exiftoolPreserveArgs: z.string().optional(), exiftoolUnsafeWipeArgs: z.string().optional(), exiftoolCustomArgs: z.string().optional(), processingOrder: z.enum(["original", "path-asc", "path-desc", "size-asc", "size-desc", "random", "sequential"]).optional(), excludedFormatsText: z.string().optional(),
  downscaleEnabled: z.boolean().optional(), downscaleMode: z.enum(["resolution", "percent", "file-size", "shortest-side", "longest-side", "megapixels"]).optional(), downscaleWidth: z.number().optional(), downscaleHeight: z.number().optional(), downscalePercent: z.number().optional(), downscaleFileSizeKb: z.number().optional(), downscaleShortestSide: z.number().optional(), downscaleLongestSide: z.number().optional(), downscaleMegapixels: z.number().optional(), downscaleResample: z.string().optional(),
  selectedPreset: z.string().optional(),
  selectedPaths: z.array(z.string()).optional(), inputViewMode: z.enum(["list", "tree"]).optional(), inputSortField: z.enum(["name", "ext", "size", "dir"]).optional(), inputSortDesc: z.boolean().optional(), showOriginalPreview: z.boolean().optional(),
  phase: z.enum(["idle", "running", "completed", "cancelled", "error"]).optional(),
  progress: z.number().optional(),
  progressText: z.string().optional(),
  currentFile: z.string().optional(),
  logs: z.array(z.string()).optional(),
  showProgressCounter: z.boolean().optional(), showProgressSummary: z.boolean().optional(), showProgressEta: z.boolean().optional(), showProgressFormat: z.boolean().optional(), showProgressEncoder: z.boolean().optional(), showRawProgress: z.boolean().optional(), showProgressCurrentFile: z.boolean().optional(), showProgressSizeChange: z.boolean().optional(),
  environment: z.array(z.object({ id: z.string(), label: z.string(), purpose: z.string(), path: z.string().optional(), available: z.boolean(), runnable: z.boolean(), version: z.string().optional(), detail: z.string().optional() })).optional(), environmentCheckedAt: z.string().optional(),
  settingsTab: z.enum(["common", "conversion", "files", "general"]).optional(),
  resultTab: z.enum(["results", "issues", "logs"]).optional(),
}).passthrough()

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "clipboard", "localFiles", "config", "env"] },
  schemas: { data: dataSchema as unknown as NodeSchema<XlchemyCardState>, config: dataSchema as unknown as NodeSchema<Partial<XlchemyCardState>> },
} satisfies AppNodeEntry<typeof core, XlchemyCardState, Partial<XlchemyCardState>>
