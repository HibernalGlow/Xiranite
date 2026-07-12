import { FileImage, Gauge, Layers3 } from "lucide-react"
import type { XlchemyFormat } from "@xiranite/node-xlchemy/core"

export const FORMATS: Array<{ value: XlchemyFormat; label: string; extension: string }> = [
  { value: "JPEG XL", label: "JPEG XL", extension: ".jxl" },
  { value: "AVIF", label: "AVIF", extension: ".avif" },
  { value: "WebP", label: "WebP", extension: ".webp" },
  { value: "PNG", label: "PNG", extension: ".png" },
  { value: "TIFF", label: "TIFF", extension: ".tiff" },
  { value: "JPEG", label: "JPEG", extension: ".jpg" },
]

export const PRESETS = [
  { id: "alpha", label: "Alpha", format: "JPEG XL" as const, lossless: true, quality: 100, effort: 7, icon: Layers3 },
  { id: "beta", label: "Beta", format: "JPEG XL" as const, lossless: false, quality: 90, effort: 7, icon: Gauge },
  { id: "gamma", label: "Gamma", format: "WebP" as const, lossless: false, quality: 82, effort: 6, icon: FileImage },
]
