import { useState } from "react"
import { page } from "vitest/browser"
import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { Switch } from "@/components/ui/switch"
import {
  FloatingWindowCaptionControls,
  FloatingWindowFrameProvider,
} from "./FloatingWindowFrame"

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
