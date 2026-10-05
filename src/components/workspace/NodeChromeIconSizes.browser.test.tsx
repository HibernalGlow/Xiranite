import { page } from "vitest/browser"
import { afterEach, describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

// 真实样式表——和 src/main.tsx 同一批。不带样式表的图标尺寸测不出级联，只会量到 Tailwind 的类。
import "@/styles/tailwind.css"
import "@/index.css"
import "@/styles/themes/index.css"
import "@/styles/design/md3-components.css"
import "@/styles/design/md3-settings-nav.css"

import {
  Expand,
  ExternalLink,
  Maximize2,
  Minus,
  Share2,
  X,
} from "lucide-react"

import { DefaultNodeDragGrip, NodeSurfaceChrome } from "./NodeSurfaceChrome"
import { WindowControlIcon } from "./WindowControlIcon"
import { WorkspaceAppearance } from "@/components/workspace/WorkspaceAppearance"
import { DEFAULT_DESIGN_THEME } from "@/lib/design-theme/contract"
import { useWorkspaceStore } from "@/store/workspaceStore"

/**
 * 操作栏（动态岛）图标的尺寸一致性尺。
 *
 * 用户 2026-10-05 指着这条栏说「图标大小不一致」。图标各自带 `h-3 w-3`，
 * 容器又用 `[&_svg]:size-3` 之类的后代选择器——后代选择器的特异性(0,1,1)高于元素自身
 * 的类(0,1,0)，所以「谁被包在哪一层容器里」决定了最终尺寸。这类坏只有真 CSS 引擎看得见。
 */
const chromeAppearance = vi.hoisted(() => ({
  visible: true,
  position: "island" as const,
  style: "pill",
  islandScale: 100,
  islandMotion: 100,
  islandDelay: 0,
  islandIdleOffset: 0,
  actionOrder: ["collapse", "focus", "fullscreen", "float", "moveToView", "hide"],
  hiddenActions: [] as string[],
}))

vi.mock("@/components/workspace/useChromeAppearance", () => ({
  useChromeAppearance: () => chromeAppearance,
}))
vi.mock("@/components/help/nodeHelpRegistry", () => ({ hasNodeHelp: () => false }))
vi.mock("@/components/help/NodeHelpSheet", () => ({ NodeHelpSheet: () => null }))

const ACTIONS = [
  { key: "collapse", label: "Collapse", icon: <Minus className="h-3 w-3" /> },
  { key: "focus", label: "Focus", icon: <Maximize2 className="h-3 w-3" /> },
  { key: "fullscreen", label: "Fullscreen", icon: <Expand className="h-3 w-3" /> },
  { key: "float", label: "Float", icon: <ExternalLink className="h-3 w-3" /> },
  { key: "moveToView", label: "Move to view", icon: <Share2 className="h-3 w-3" /> },
  { key: "hide", label: "Hide", icon: <X className="h-3 w-3" /> },
]

/** 整条岛上的每一个 svg 都算，包括拖拽把手——不一致正是出在「把手吃不到按钮那条规则」。 */
function iconSizes(): Array<{ key: string; w: number; h: number }> {
  const island = document.querySelector("[role='toolbar']")
  if (!island) return []
  return [...island.querySelectorAll("svg")].map((svg, index) => {
    const box = svg.getBoundingClientRect()
    const owner = svg.closest("[data-action-key]") ?? svg.closest("[data-node-chrome-action]")
    return {
      key: owner?.getAttribute("data-action-key") ?? `handle-${String(index)}`,
      w: Math.round(box.width * 10) / 10,
      h: Math.round(box.height * 10) / 10,
    }
  })
}

async function mountWithDesignTheme(md3: boolean) {
  useWorkspaceStore.getState().setDesignTheme(md3 ? { ...DEFAULT_DESIGN_THEME, id: "md3" } : { ...DEFAULT_DESIGN_THEME })
  await new Promise((resolve) => setTimeout(resolve, 60))
  const view = render(
    <>
      <WorkspaceAppearance />
      <div className="group" style={{ position: "relative", height: 120 }}>
        <NodeSurfaceChrome actions={ACTIONS} moduleName="demo" dragHandle={<DefaultNodeDragGrip />} />
      </div>
    </>,
  )
  for (let attempt = 0; attempt < 100 && document.querySelectorAll("[role='toolbar'] svg").length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  // 展开态才有图标（收起时只有一根指示条）。
  const island = document.querySelector(".group > div")
  island?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 400))
  return view
}

afterEach(() => {
  useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME })
  document.documentElement.removeAttribute("style")
})

describe("node chrome icon sizes", () => {
  test("all six icons must render at one size, with and without MD3", async () => {
    const offView = await mountWithDesignTheme(false)
    const off = iconSizes()
    console.log(`CHROME_OFF ${JSON.stringify(off)}`)

    offView.unmount()
    await mountWithDesignTheme(true)
    const on = iconSizes()
    console.log(`CHROME_ON ${JSON.stringify(on)}`)
    // 截图要在**展开态**拍：收起态只剩一根指示条，看了也证明不了图标一致。
    // React 的 onPointerEnter 是从原生 pointerover 模拟的，直接 dispatch pointerenter 不生效；
    // 用真 hover 才会把岛展开（收起态截图只会拍到一根指示条，证明不了图标一致）。
    const island = page.getByRole("toolbar", { name: "Node operation island" })
    await island.hover()
    await new Promise((resolve) => setTimeout(resolve, 500))
    await island.screenshot({ path: ".cache/chrome-icons.png" })

    expect(on.length).toBe(7)
    const sizesOn = new Set(on.map((i) => `${i.w}x${i.h}`))
    const sizesOff = new Set(off.map((i) => `${i.w}x${i.h}`))
    expect(sizesOff.size, `原生档内部就不一致：${JSON.stringify(off)}`).toBe(1)
    expect(sizesOn.size, `MD3 档图标尺寸不一致：${JSON.stringify(on)}`).toBe(1)
  })

  test("the four caption glyphs share one size", async () => {
    useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME, id: "md3" })
    // 上一条测例把共享容器卸掉了，这里显式给一个新容器，否则 render 挂到 detached 节点上。
    const container = document.createElement("div")
    document.body.appendChild(container)
    render(
      <div data-testid="caption-icons" style={{ display: "flex", gap: 8 }}>
        <WindowControlIcon action="minimize" />
        <WindowControlIcon action="maximize" maximized={false} />
        <WindowControlIcon action="maximize" maximized />
        <WindowControlIcon action="close" />
      </div>,
      { container },
    )
    // React 19 的提交是异步的：不轮询就会在提交前量到空集合（第一次就是这么假红的）。
    for (let attempt = 0; attempt < 100 && document.querySelectorAll("[data-testid='caption-icons'] svg").length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const sizes = new Set(
      [...document.querySelectorAll("[data-testid='caption-icons'] svg")].map((svg) => {
        const box = svg.getBoundingClientRect()
        return `${String(Math.round(box.width * 10) / 10)}x${String(Math.round(box.height * 10) / 10)}`
      }),
    )
    console.log(`CAPTION ${JSON.stringify([...sizes])} svgs=${String(document.querySelectorAll("svg").length)} holders=${String(document.querySelectorAll("[data-slot]").length)}`)
    // maximize 的两个字形原来是 size-3，与 minimize/close 的 size-3.5 并排就是一大一小。
    expect(sizes.size, `标题栏字形尺寸不一致：${JSON.stringify([...sizes])}`).toBe(1)
    expect(sizes).not.toContain("0x0")
  })
})
