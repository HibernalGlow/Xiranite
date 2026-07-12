import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-xlchemy"
import { z } from "zod"
import { Component } from "./Component"
import type { XlchemyCardState } from "./types"

const dataSchema = z.object({
  action: z.enum(["plan", "convert"]).optional(),
  pathsText: z.string().optional(),
  format: z.enum(["JPEG XL", "AVIF", "WebP", "PNG", "TIFF", "JPEG"]).optional(),
  lossless: z.boolean().optional(),
  quality: z.number().optional(),
  effort: z.number().optional(),
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
  chromaSubsampling: z.string().optional(), metadataMode: z.enum(["encoder-wipe", "encoder-preserve", "exiftool-wipe", "exiftool-preserve", "exiftool-unsafe-wipe"]).optional(),
  keepIfLarger: z.boolean().optional(), copyIfLarger: z.boolean().optional(), jpegEncoder: z.enum(["jpegli", "libjpeg"]).optional(), avifEncoder: z.enum(["aom", "svt"]).optional(), avifBitDepth: z.enum(["auto", "8", "10", "12"]).optional(), processingOrder: z.enum(["original", "name", "size"]).optional(), excludedFormatsText: z.string().optional(),
  downscaleEnabled: z.boolean().optional(), downscaleMode: z.enum(["resolution", "percent", "file-size", "shortest-side", "longest-side", "megapixels"]).optional(), downscaleWidth: z.number().optional(), downscaleHeight: z.number().optional(), downscalePercent: z.number().optional(), downscaleFileSizeKb: z.number().optional(), downscaleShortestSide: z.number().optional(), downscaleLongestSide: z.number().optional(), downscaleMegapixels: z.number().optional(), downscaleResample: z.string().optional(),
  selectedPreset: z.string().optional(),
  phase: z.enum(["idle", "running", "completed", "error"]).optional(),
  progress: z.number().optional(),
  progressText: z.string().optional(),
  currentFile: z.string().optional(),
  logs: z.array(z.string()).optional(),
}).passthrough()

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "clipboard", "localFiles", "config", "env"] },
  schemas: { data: dataSchema as unknown as NodeSchema<XlchemyCardState>, config: dataSchema as unknown as NodeSchema<Partial<XlchemyCardState>> },
} satisfies AppNodeEntry<typeof core, XlchemyCardState, Partial<XlchemyCardState>>
