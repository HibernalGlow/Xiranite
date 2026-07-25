import { useState } from "react"
import type { NodeHostApi } from "@xiranite/contract"
import type { EngineVWallpaper } from "@xiranite/node-enginev/core"
import { page } from "vitest/browser"
import { expect, test } from "vitest"
import { render } from "vitest-browser-react"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { EngineVCardState } from "./types"
import { WallpaperGallery } from "./WallpaperGallery"

test("visibly changes the ID pill from gray to the theme color when selected", async () => {
  await render(<GalleryHarness />)
  const pill = document.querySelector<HTMLElement>('[data-enginev-wallpaper-selection="111"]')
  expect(pill).not.toBeNull()

  const themeRoot = pill!.closest<HTMLElement>(".theme-astro")
  expect(themeRoot).not.toBeNull()
  const gray = resolveBackground(themeRoot!, "var(--muted-foreground)")
  const primary = resolveBackground(themeRoot!, "var(--primary)")

  expect(getComputedStyle(pill!).backgroundColor).toBe(gray)
  expect(pill!.dataset.variant).toBe("secondary")

  await page.getByRole("button", { name: "选择 Ocean Loop" }).click()

  await expect.poll(() => pill!.dataset.variant).toBe("default")
  await expect.poll(() => getComputedStyle(pill!).backgroundColor).toBe(primary)
  expect(primary).not.toBe(gray)
})

function GalleryHarness() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  return (
    <div className="theme-astro h-80 w-[32rem] p-4">
      <TooltipProvider>
        <WallpaperGallery
          host={host}
          selectedIds={selectedIds}
          wallpapers={[wallpaper]}
          onCopyPath={() => undefined}
          onToggle={(id) => setSelectedIds((current) => current.includes(id) ? [] : [id])}
        />
      </TooltipProvider>
    </div>
  )
}

function resolveBackground(root: HTMLElement, value: string): string {
  const probe = document.createElement("div")
  probe.style.background = value
  root.append(probe)
  const resolved = getComputedStyle(probe).backgroundColor
  probe.remove()
  return resolved
}

const host = {
  localFiles: {
    getUrl: (path: string) => `http://local.test/local-files?path=${encodeURIComponent(path)}`,
  },
} as NodeHostApi<EngineVCardState, Partial<EngineVCardState>>

const wallpaper: EngineVWallpaper = {
  path: "D:/workshop/111",
  folderName: "111",
  workshopId: "111",
  title: "Ocean Loop",
  description: "calm motion",
  contentRating: "Everyone",
  ratingSex: "",
  ratingViolence: "",
  tags: ["test"],
  fileName: "scene.mp4",
  preview: "preview.png",
  wallpaperType: "Video",
  createdTime: "2026-01-01T00:00:00.000Z",
  modifiedTime: "2026-01-01T00:00:00.000Z",
  size: 1024,
  projectData: {},
}
