import type { XlchemyFormat } from "@xiranite/node-xlchemy/core"

export const FORMATS: Array<{ value: XlchemyFormat; label: string; extension: string }> = [
  { value: "JPEG XL", label: "JPEG XL", extension: ".jxl" },
  { value: "AVIF", label: "AVIF", extension: ".avif" },
  { value: "WebP", label: "WebP", extension: ".webp" },
  { value: "PNG", label: "PNG", extension: ".png" },
  { value: "TIFF", label: "TIFF", extension: ".tiff" },
  { value: "JPEG", label: "JPEG", extension: ".jpg" },
  { value: "Lossless JPEG Transcoding", label: "JPEG 无损转码", extension: ".jxl" },
  { value: "JPEG Reconstruction", label: "JPEG 重建", extension: ".jpg" },
]

export const PRESETS = [
  { id: "alpha", label: "Alpha", format: "JPEG XL" as const, lossless: true, quality: 100, effort: 7 },
  { id: "beta", label: "Beta", format: "JPEG XL" as const, lossless: false, quality: 90, effort: 7 },
  { id: "gamma", label: "Gamma", format: "WebP" as const, lossless: false, quality: 82, effort: 6 },
]

export const ENVIRONMENT_TARGETS = [
  ["cjxl", "cjxl", "JPEG XL 编码"],
  ["djxl", "djxl", "JPEG XL 解码与校验"],
  ["jxlinfo", "jxlinfo", "JPEG XL 信息检查"],
  ["cjpegli", "cjpegli", "JPEGli 编码"],
  ["magick", "ImageMagick", "PNG/TIFF、缩小与格式回退"],
  ["avifenc", "avifenc", "AVIF 编码"],
  ["avifdec", "avifdec", "AVIF 解码"],
  ["slimg-cffi", "slimg CFFI", "slimg DLL AVIF 编码"],
  ["cwebp", "cwebp", "WebP 编码"],
  ["oxipng", "oxipng", "PNG 无损优化"],
  ["exiftool", "ExifTool", "元数据复制与清理"],
  ["jpegtran", "jpegtran", "JPEG 无损变换与重建"],
] as const
