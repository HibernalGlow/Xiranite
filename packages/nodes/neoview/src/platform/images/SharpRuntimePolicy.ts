import {
  DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG,
  type NeoviewImageProcessingConfig,
} from "../../application/config/ReaderImageProcessingConfig.js"

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"])
const DISABLED_VALUES = new Set(["0", "false", "no", "off"])

/**
 * Sharp is temporarily opt-in for NeoView. Keep the switch at the platform
 * composition boundary so browser-supported assets continue over the original
 * loopback HTTP route without loading libvips.
 */
export function isNeoViewSharpEnabled(
  value = process.env.XIRANITE_NEOVIEW_SHARP,
  configured = false,
): boolean {
  if (value === undefined) return configured
  const normalized = value.trim().toLowerCase()
  if (ENABLED_VALUES.has(normalized)) return true
  if (DISABLED_VALUES.has(normalized)) return false
  return configured
}

export class NeoViewImageProcessingRuntimePolicy {
  #config: NeoviewImageProcessingConfig

  constructor(config: NeoviewImageProcessingConfig = { ...DEFAULT_NEOVIEW_IMAGE_PROCESSING_CONFIG }) {
    this.#config = { ...config }
  }

  update(config: NeoviewImageProcessingConfig): void {
    this.#config = { ...config }
  }

  snapshot(): Readonly<NeoviewImageProcessingConfig> {
    return { ...this.#config }
  }

  get enabled(): boolean { return this.#config.enabled }
  get readerTransformEnabled(): boolean { return this.enabled && this.#config.readerTransformEnabled }
  get jxlTransformEnabled(): boolean { return this.enabled && this.#config.jxlTransformEnabled }
  get wicNativeEnabled(): boolean { return this.enabled && this.#config.wicNativeEnabled }
  get windowsShellNativeEnabled(): boolean { return this.enabled && this.#config.windowsShellNativeEnabled }
  get thumbnailTransformEnabled(): boolean { return this.enabled && this.#config.thumbnailTransformEnabled }
  get folderMosaicEnabled(): boolean { return this.enabled && this.#config.folderMosaicEnabled }
  get sharpFallbackEnabled(): boolean {
    return this.enabled && isNeoViewSharpEnabled(process.env.XIRANITE_NEOVIEW_SHARP, this.#config.sharpFallbackEnabled)
  }
  get jxlLossless(): boolean { return this.#config.jxlLossless }
  get jxlQuality(): number { return this.#config.jxlQuality }
  get thumbnailLossless(): boolean { return this.#config.thumbnailLossless }
  get thumbnailQuality(): number { return this.#config.thumbnailQuality }
  get mosaicLossless(): boolean { return this.#config.mosaicLossless }
  get mosaicQuality(): number { return this.#config.mosaicQuality }
}
