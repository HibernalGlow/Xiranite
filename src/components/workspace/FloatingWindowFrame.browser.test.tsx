import { useState } from "react"
import { page } from "vitest/browser"
import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { Switch } from "@/components/ui/switch"
import type { WindowCapabilities } from "@/backend/runtime/runtime"
import {
  FloatingWindowCaptionControls,
  FloatingWindowFrameProvider,
  FloatingWindowNodeHeader,
} from "./FloatingWindowFrame"
import { captionBandInlinePx } from "./captionBand"

describe("floating window capsule browser behavior", () => {
  test("expands on hover and stays expanded when auto-collapse is disabled", async () => {
    const control = vi.fn()
    const screen = await render(<CapsuleWindowHarness control={control} />)
    const autoCollapse = screen.getByRole("switch", { name: "自动收起胶囊" })
    const capsule = document.querySelector<HTMLElement>('[data-window-caption-style="capsule"]')

    expect(capsule).not.toBeNull()
    await expect.element(autoCollapse).toHaveAttribute("data-state", "checked")
    expect(capsule?.dataset.windowCaptionVisibility).toBe("expand-on-hover")
    await expect.poll(() => Math.round(capsule?.getBoundingClientRect().width ?? 0)).toBe(28)

    await page.elementLocator(capsule!).hover()
    await expect.poll(() => Math.round(capsule?.getBoundingClientRect().width ?? 0)).toBe(68)
    await expect.element(screen.getByRole("button", { name: "最小化" })).toBeVisible()

    await autoCollapse.click()
    await expect.element(autoCollapse).toHaveAttribute("data-state", "unchecked")
    await expect.poll(() => capsule?.dataset.windowCaptionVisibility).toBe("always-expanded")
    await expect.poll(() => Math.round(capsule?.getBoundingClientRect().width ?? 0)).toBe(68)
    expect(capsule?.querySelector("[data-node-chrome-idle-indicator]")).toBeNull()

    await screen.getByRole("button", { name: "关闭窗口" }).click()
    expect(control).toHaveBeenCalledWith("close")
  })
})

function CapsuleWindowHarness({ control }: { control: (action: "minimize" | "maximize" | "close") => void }) {
  const [autoCollapse, setAutoCollapse] = useState(true)

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mb-8 flex items-center gap-3">
        <label htmlFor="capsule-auto-collapse">自动收起胶囊</label>
        <Switch
          id="capsule-auto-collapse"
          checked={autoCollapse}
          onCheckedChange={setAutoCollapse}
          aria-label="自动收起胶囊"
        />
      </div>
      <FloatingWindowFrameProvider value={{
        captionAppearance: { position: "right", style: "capsule", autoCollapse },
        isMaximized: false,
        pending: false,
        control,
        handleTitlebarDoubleClick: vi.fn(),
        registerIntegratedTitlebar: () => () => undefined,
      }}>
        <FloatingWindowCaptionControls />
      </FloatingWindowFrameProvider>
    </main>
  )
}

const systemCaption: WindowCapabilities = {
  supported: true,
  nativeWindowControls: true,
  frameless: true,
  captionOwner: "system",
  captionInset: { x: 16, y: 26 },
  componentWindows: "native",
}

const rendererCaption: WindowCapabilities = { ...systemCaption, captionOwner: "renderer", captionInset: undefined }

describe("caption ownership", () => {
  test("draws no window buttons and pads the node title bar past the band the host reported", async () => {
    await render(<CaptionBandHarness capabilities={systemCaption} />)

    expect(document.querySelectorAll("[data-window-caption-button]")).toHaveLength(0)
    const titlebar = document.querySelector<HTMLElement>('[data-floating-window-titlebar="true"]')
    expect(titlebar).not.toBeNull()
    // x=16 from the host, plus the measured 60pt group and its clearance.
    await expect.poll(() => getComputedStyle(titlebar!).paddingLeft).toBe("84px")
  })

  /** The same harness unpadded: without this the assertion above could pass on stale or global CSS. */
  test("keeps the app-drawn buttons and an unpadded title bar when the renderer owns the caption", async () => {
    await render(<CaptionBandHarness capabilities={rendererCaption} />)

    // Three from the node header's integrated cluster and three from the window's own fallback cluster.
    await expect.poll(() => document.querySelectorAll("[data-window-caption-button]").length).toBe(6)
    const titlebar = document.querySelector<HTMLElement>('[data-floating-window-titlebar="true"]')
    expect(titlebar).not.toBeNull()
    expect(getComputedStyle(titlebar!).paddingLeft).toBe("0px")
  })
})

function CaptionBandHarness({ capabilities }: { capabilities: WindowCapabilities }) {
  return (
    <div
      className="xiranite-floating-window relative flex h-screen flex-col bg-background text-foreground"
      data-floating-window-caption={capabilities.captionOwner}
    >
      <FloatingWindowFrameProvider value={{
        captionOwner: capabilities.captionOwner,
        captionBandInlinePx: captionBandInlinePx(capabilities.captionInset),
        isMaximized: false,
        pending: false,
        control: vi.fn(),
        handleTitlebarDoubleClick: vi.fn(),
        registerIntegratedTitlebar: () => () => undefined,
      }}>
        <FloatingWindowNodeHeader>
          <span>Node title</span>
        </FloatingWindowNodeHeader>
        <FloatingWindowCaptionControls />
      </FloatingWindowFrameProvider>
    </div>
  )
}
