import type { CliInteractionPreferencesSource, InteractionValues } from "@xiranite/cli-runtime/interaction"
import type { XlchemyAction, XlchemyFormat, XlchemyInput } from "./core.js"
import { createXlchemyInteractionSchema } from "./interaction.js"

export type XlchemyNodeConfig = Record<string, unknown> & { cli?: CliInteractionPreferencesSource["cli"] }
const VALUE_FLAGS: Record<string, string> = { "--format": "format", "--quality": "quality", "--effort": "effort", "--threads": "threads", "--output": "outputDir", "--existing": "existingPolicy", "--jpeg-encoder": "jpegEncoder", "--avif-encoder": "avifEncoder", "--avif-bit-depth": "avifBitDepth", "--jxl-normalize-when": "jxlNormalizeWhen", "--chroma-subsampling": "chromaSubsampling", "--delete-original-mode": "deleteOriginalMode", "--processing-order": "processingOrder", "--exclude": "excludedFormatsText", "--metadata-mode": "metadataMode", "--exiftool-wipe-args": "exiftoolWipeArgs", "--exiftool-preserve-args": "exiftoolPreserveArgs", "--exiftool-unsafe-wipe-args": "exiftoolUnsafeWipeArgs", "--exiftool-custom-args": "exiftoolCustomArgs", "--downscale-mode": "downscaleMode", "--width": "downscaleWidth", "--height": "downscaleHeight", "--percent": "downscalePercent", "--target-kb": "downscaleFileSizeKb", "--shortest-side": "downscaleShortestSide", "--longest-side": "downscaleLongestSide", "--megapixels": "downscaleMegapixels", "--resample": "downscaleResample", "--ram-optimizer": "ramOptimizer", "--ram-rules": "ramOptimizerRules", "--cjxl-args": "cjxlArgs", "--avifenc-args": "avifencArgs", "--cjpegli-args": "cjpegliArgs", "--imagemagick-args": "imageMagickArgs" }
const NUMBER_FIELDS = new Set(["quality", "effort", "threads", "downscaleWidth", "downscaleHeight", "downscalePercent", "downscaleFileSizeKb", "downscaleShortestSide", "downscaleLongestSide", "downscaleMegapixels"])
const BOOLEAN_FLAGS: Record<string, [string, boolean]> = { "--lossless": ["lossless", true], "--lossy": ["lossless", false], "--max-compression": ["maxCompression", true], "--aom-iq-tune": ["avifAomIqTune", true], "--disable-progressive-jpegli": ["disableProgressiveJpegli", true], "--auto-lossless-jpeg": ["autoLosslessJpeg", true], "--no-auto-lossless-jpeg": ["autoLosslessJpeg", false], "--intelligent-effort": ["intelligentEffort", true], "--jxl-modular": ["jxlModular", true], "--jxl-verify": ["jxlVerify", true], "--jxl-png-fallback": ["jxlPngFallback", true], "--no-jxl-png-fallback": ["jxlPngFallback", false], "--jxl-normalize": ["jxlNormalize", true], "--no-smallest-png": ["smallestPng", false], "--no-smallest-webp": ["smallestWebp", false], "--no-smallest-jxl": ["smallestJxl", false], "--flat": ["preserveStructure", false], "--timestamps": ["preserveTimestamps", true], "--no-recursive": ["recursive", false], "--delete-original": ["deleteOriginal", true], "--keep-if-larger": ["keepIfLarger", true], "--copy-if-larger": ["copyIfLarger", true], "--strip-metadata": ["preserveMetadata", false], "--downscale": ["downscaleEnabled", true], "--custom-args": ["enableCustomArgs", true], "--overwrite": ["overwrite", true] }
const LEGACY_CONFIG_KEYS: Record<string, string> = { outputDir: "output_dir", existingPolicy: "existing_policy", preserveMetadata: "preserve_metadata", preserveStructure: "preserve_structure", preserveTimestamps: "preserve_timestamps" }

export function buildPipeInput(args: string[], config: XlchemyNodeConfig = {}, paths = parseXlchemyPositional(args)): XlchemyInput {
  const action: XlchemyAction = args.includes("diagnose") ? "diagnose" : args.includes("convert") ? "convert" : "plan"
  const schema = createXlchemyInteractionSchema(interactionDefaults(config))
  const values: InteractionValues = { ...schema.initialValues, action, pathsText: paths.join("\n") }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!, bool = BOOLEAN_FLAGS[arg]
    if (bool) { values[bool[0]] = bool[1]; continue }
    const id = VALUE_FLAGS[arg]
    if (!id) continue
    const raw = args[index + 1]
    if (raw === undefined) continue
    values[id] = NUMBER_FIELDS.has(id) ? Number(raw) : id === "format" ? normalizeFormat(raw) : raw
    index += 1
  }
  if (values.outputDir) values.outputMode = "directory"
  if (args.includes("--overwrite")) values.existingPolicy = "replace"
  if (args.includes("--strip-metadata") && values.metadataMode === "encoder-preserve") values.metadataMode = "encoder-wipe"
  return schema.toInput(values)
}

export function interactionDefaults(config: XlchemyNodeConfig): Partial<InteractionValues> {
  const defaults: InteractionValues = {}, ids = createXlchemyInteractionSchema().fields.map((field) => field.id)
  for (const id of ids) { const value = config[id] ?? config[LEGACY_CONFIG_KEYS[id] ?? ""]; if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") defaults[id] = value }
  return defaults
}
export function parseXlchemyPositional(args: string[]) { const commands = new Set(["plan", "convert", "diagnose"]), options = new Set(Object.keys(VALUE_FLAGS)); return args.filter((arg, index) => !arg.startsWith("--") && !commands.has(arg) && !options.has(args[index - 1] ?? "")) }
function normalizeFormat(value: string): XlchemyFormat { const key = value.toLowerCase().replace(/[ _-]+/g, ""); return ({ jxl: "JPEG XL", jpegxl: "JPEG XL", avif: "AVIF", webp: "WebP", png: "PNG", tiff: "TIFF", tif: "TIFF", jpeg: "JPEG", jpg: "JPEG", losslessjpeg: "Lossless JPEG Transcoding", reconstruction: "JPEG Reconstruction", smallest: "Smallest Lossless" } as Record<string, XlchemyFormat>)[key] ?? value as XlchemyFormat }
