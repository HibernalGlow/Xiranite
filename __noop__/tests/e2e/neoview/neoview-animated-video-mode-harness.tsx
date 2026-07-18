import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

import "../../../src/styles/tailwind.css"
import "../../../src/index.css"
import "../../../src/styles/themes/index.css"
import type { ReaderMediaConfigDto } from "../../../src/nodes/neoview/adapters/reader-http-client"
import AnimatedVideoModeCard from "../../../src/nodes/neoview/features/panels/cards/AnimatedVideoModeCard"

const source = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#0b1017"/>
    <rect x="72" y="56" width="1056" height="688" rx="12" fill="#264c63" stroke="#e4bd6b" stroke-width="16"/>
    <circle cx="600" cy="350" r="150" fill="#d56b5d"/>
    <text x="600" y="635" text-anchor="middle" font-family="sans-serif" font-size="56" fill="#fff">NeoView animated media</text>
  </svg>
`)}`

const initialMedia: ReaderMediaConfigDto = {
  supportedImageFormats: ["png", "webp"],
  videoFormats: ["mp4"],
  mediaMimeTypes: { mp4: "video/mp4" },
  autoPlayAnimatedImages: true,
  animatedVideoEnabled: false,
  animatedVideoKeywords: ["[#dyna]"],
  videoMinPlaybackRate: 0.25,
  videoMaxPlaybackRate: 16,
  videoPlaybackRateStep: 0.25,
  subtitle: { fontSize: 1, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
}

function Harness() {
  const [opened, setOpened] = useState(false)
  const [media, setMedia] = useState(initialMedia)
  const [writes, setWrites] = useState(0)

  async function updateMedia(patch: Partial<ReaderMediaConfigDto>): Promise<ReaderMediaConfigDto> {
    setWrites((count) => count + 1)
    const next = { ...media, ...patch }
    setMedia(next)
    document.documentElement.dataset.animatedVideoWrites = String(writes + 1)
    return next
  }

  return (
    <main className="grid h-screen overflow-hidden bg-neutral-950 text-foreground" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
      <section className="relative grid min-h-0 place-items-center overflow-hidden bg-neutral-950 p-8" aria-label="阅读页面">
        <img
          data-reader-page-image="animated-video-page"
          src={source}
          alt="NeoView animated media"
          width={936}
          height={624}
          className="max-h-full max-w-full object-contain"
        />
        <nav className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2" aria-label="测试会话">
          <button className="rounded border border-white/25 bg-black/70 px-3 py-1.5 text-xs text-white" onClick={() => setOpened((value) => !value)}>
            {opened ? "关闭书本" : "打开书本"}
          </button>
        </nav>
        <div className="pointer-events-none absolute left-5 top-5 rounded bg-black/60 px-2 py-1 text-xs text-white" data-reader-book-state={opened ? "open" : "closed"}>
          {opened ? "书本已打开" : "未打开书本"}
        </div>
      </section>
      <aside className="overflow-y-auto border-l border-border bg-background px-3 py-4" aria-label="控制面板">
        <header className="mb-3 border-b border-border pb-3">
          <p className="text-xs text-muted-foreground">控制</p>
          <h1 className="text-sm font-semibold">动图视频模式</h1>
        </header>
        <AnimatedVideoModeCard media={media} onMediaChange={updateMedia} />
        <output className="sr-only" aria-label="配置写入次数">{writes}</output>
      </aside>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>)
