import { useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type {
  ReaderHttpClient,
  ReaderPageDto,
  ReaderSuperResolutionConfigDto,
} from "../../../src/nodes/neoview/adapters/reader-http-client"
import { PageImage } from "../../../src/nodes/neoview/features/reader/PageImage"

const redPage = page("red-page", 0, "red.svg", solidSvg("#dc2626"))
const bluePage = page("blue-page", 1, "blue.svg", "/tests/e2e/neoview/delayed-blue.svg")
const enabled: ReaderSuperResolutionConfigDto = {
  provider: "opencomic-system",
  preferences: { autoUpscaleEnabled: true },
}
const disabled: ReaderSuperResolutionConfigDto = {
  provider: "opencomic-system",
  preferences: { autoUpscaleEnabled: false },
}
const client = {
  async upscalePage() {
    return {
      status: "hit" as const,
      artifactUrl: "/tests/e2e/neoview/delayed-green.svg",
      contentType: "image/svg+xml",
      bytes: 128,
      version: "green-v1",
    }
  },
} as ReaderHttpClient

function Harness() {
  const [currentPage, setCurrentPage] = useState(redPage)
  const [superResolution, setSuperResolution] = useState(disabled)

  return (
    <main className="grid h-screen grid-rows-[1fr_auto] overflow-hidden bg-black text-white">
      <section className="grid min-h-0 place-items-center overflow-hidden" aria-label="阅读画面">
        <PageImage
          page={currentPage}
          scale={1}
          sessionId="seamless-harness"
          client={client}
          superResolution={superResolution}
        />
      </section>
      <nav className="flex items-center justify-center gap-3 border-t border-white/20 bg-neutral-950 p-3" aria-label="测试控制">
        <button type="button" onClick={() => setCurrentPage(bluePage)}>下一页</button>
        <button type="button" onClick={() => setSuperResolution(enabled)}>启用超分</button>
        <button type="button" onClick={() => setSuperResolution(disabled)}>关闭超分</button>
      </nav>
    </main>
  )
}

function page(id: string, index: number, name: string, assetUrl: string): ReaderPageDto {
  return {
    id,
    index,
    name,
    mediaKind: "image",
    mimeType: "image/svg+xml",
    byteLength: 128,
    dimensions: { width: 640, height: 480 },
    contentVersion: "v1",
    assetUrl,
  }
}

function solidSvg(color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/></svg>`)}`
}

createRoot(document.getElementById("root")!).render(<Harness />)
