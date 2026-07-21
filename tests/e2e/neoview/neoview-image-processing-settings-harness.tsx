import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type {
  ReaderImageProcessingConfigDto,
  ReaderMediaConfigDto,
} from "../../../src/nodes/neoview/adapters/reader-http-client"
import { MediaSettingsCard } from "../../../src/nodes/neoview/features/settings/cards/MediaSettingsCard"

const initialProcessing: ReaderImageProcessingConfigDto = {
  enabled: true,
  readerTransformEnabled: false,
  jxlTransformEnabled: true,
  wicNativeEnabled: true,
  windowsShellNativeEnabled: true,
  thumbnailTransformEnabled: true,
  folderMosaicEnabled: false,
  sharpFallbackEnabled: false,
  jxlLossless: false,
  jxlQuality: 90,
  thumbnailLossless: false,
  thumbnailQuality: 82,
  mosaicLossless: false,
  mosaicQuality: 82,
}

const media: ReaderMediaConfigDto = {
  supportedImageFormats: ["jpg", "png", "webp", "avif", "jxl"],
  videoFormats: ["mp4", "webm", "mkv"],
  mediaMimeTypes: {},
  autoPlayAnimatedImages: true,
  animatedVideoEnabled: false,
  animatedVideoKeywords: [],
  videoMinPlaybackRate: 0.25,
  videoMaxPlaybackRate: 16,
  videoPlaybackRateStep: 0.25,
  subtitle: { fontSize: 24, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
}

function Harness() {
  const [processing, setProcessing] = useState(initialProcessing)
  const [writes, setWrites] = useState(0)
  async function updateProcessing(patch: Partial<ReaderImageProcessingConfigDto>) {
    const next = { ...processing, ...patch }
    setProcessing(next)
    setWrites((count) => count + 1)
    return next
  }
  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto w-full max-w-3xl">
        <MediaSettingsCard
          media={media}
          onMedia={async () => media}
          imageProcessing={processing}
          onImageProcessing={updateProcessing}
        />
      </div>
      <output className="sr-only" aria-label="图像处理配置写入次数">{writes}</output>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
