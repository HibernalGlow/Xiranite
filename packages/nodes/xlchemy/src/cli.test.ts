import { describe, expect, test } from "vitest"
import { buildPipeInput } from "./cli-input.js"

describe("Xlchemy pipe CLI", () => {
  test("maps complete format, file, metadata, resize, RAM, and custom argument flags", () => {
    const input = buildPipeInput([
      "convert", "D:/images", "--format", "avif", "--avif-encoder", "slimg", "--avif-bit-depth", "10", "--quality", "72", "--threads", "12",
      "--output", "D:/out", "--existing", "rename", "--flat", "--timestamps", "--delete-original", "--delete-original-mode", "trash",
      "--metadata-mode", "exiftool-custom", "--exiftool-custom-args", '-Artist="X" "$dst"', "--downscale", "--downscale-mode", "megapixels", "--megapixels", "3.2", "--resample", "lanczos",
      "--processing-order", "size-desc", "--exclude", "gif,bmp", "--ram-optimizer", "dynamic", "--ram-rules", '("all", 10, "1")',
      "--custom-args", "--avifenc-args", "--foo bar",
    ])
    expect(input).toMatchObject({ action: "convert", paths: ["D:/images"], format: "AVIF", avifEncoder: "slimg", avifBitDepth: "10", quality: 72, threads: 12, outputMode: "directory", outputDir: "D:/out", existingPolicy: "rename", preserveStructure: false, preserveTimestamps: true, deleteOriginal: true, deleteOriginalMode: "trash", metadataMode: "exiftool-custom", exiftoolCustomArgs: '-Artist="X" "$dst"', processingOrder: "size-desc", excludedFormats: ["gif", "bmp"], ramOptimizer: "dynamic", ramOptimizerRules: '("all", 10, "1")', enableCustomArgs: true, avifencArgs: "--foo bar", downscale: { enabled: true, mode: "megapixels", megapixels: 3.2, resample: "lanczos" } })
  })

  test("accepts documented short format aliases and both modern and legacy TOML keys", () => {
    expect(buildPipeInput(["plan", "D:/a.png", "--format", "jxl"], { quality: 66, output_dir: "D:/legacy", existing_policy: "rename" })).toMatchObject({ format: "JPEG XL", quality: 66, outputMode: "directory", outputDir: "D:/legacy", existingPolicy: "rename" })
    expect(buildPipeInput(["plan", "D:/a.png"], { format: "WebP", outputDir: "D:/modern", preserveMetadata: false })).toMatchObject({ format: "WebP", outputMode: "directory", outputDir: "D:/modern", preserveMetadata: false })
  })

  test("derives overwrite and metadata policies without treating flag values as paths", () => {
    const input = buildPipeInput(["convert", "D:/a.png", "--format", "jpeg", "--overwrite", "--strip-metadata", "--jpeg-encoder", "libjpeg"])
    expect(input).toMatchObject({ paths: ["D:/a.png"], format: "JPEG", existingPolicy: "replace", overwrite: true, preserveMetadata: false, metadataMode: "encoder-wipe", jpegEncoder: "libjpeg" })
  })
})
