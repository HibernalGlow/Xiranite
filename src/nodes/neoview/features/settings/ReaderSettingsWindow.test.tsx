import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { DEFAULT_READER_RADIAL_MENU_CONFIG } from "@xiranite/node-neoview/ui-core"

vi.mock("./cards/PanelLayoutEditor", () => ({ default: () => <div data-testid="panel-layout-editor">editor</div> }))

import { ReaderSettingsWindow } from "./ReaderSettingsWindow"

afterEach(cleanup)

describe("ReaderSettingsWindow", () => {
  it("[neoview.settings.window] follows the standalone categorized settings fixture and defers Kanban", async () => {
    const save = vi.fn(async () => undefined)
    const saveViewDefaults = vi.fn(async () => undefined)
    const saveWorkspace = vi.fn()
    render(
      <ReaderSettingsWindow
        shell={shell()}
        viewDefaults={{ fitMode: "fit", pageMode: "single" }}
        slideshow={{ intervalSeconds: 5, loop: false, random: false, fadeTransition: true }}
        media={media()}
        inputBindings={{ bindings: [] }}
        radialMenu={DEFAULT_READER_RADIAL_MENU_CONFIG}
        onClose={vi.fn()}
        onBoardLayout={save}
        onViewDefaults={saveViewDefaults}
        onSlideshow={vi.fn(async () => undefined)}
        onMedia={vi.fn(async () => media())}
        onInputBindings={vi.fn(async () => ({ bindings: [] }))}
        onRadialMenu={vi.fn(async () => DEFAULT_READER_RADIAL_MENU_CONFIG)}
        onMaterial={vi.fn(async () => shell())}
        onWorkspace={saveWorkspace}
      />,
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "NeoView 设置分类" })).toBeTruthy()
    expect(await screen.findByRole("heading", { name: "泳道与布局" })).toBeTruthy()
    expect(screen.getByRole("tablist", { name: "泳道与布局分区" })).toBeTruthy()
    expect(screen.queryByTestId("panel-layout-editor")).toBeNull()
    fireEvent.click(within(screen.getByRole("group", { name: "默认启动视图" })).getByRole("button", { name: "泳道" }))
    expect(saveWorkspace).toHaveBeenCalledWith({ mode: "swimlane" })
    expect(screen.getByText("泳道焦点与独占")).toBeTruthy()
    fireEvent.click(screen.getByRole("switch", { name: "Reader 聚焦时自动独占" }))
    expect(saveWorkspace).toHaveBeenCalledWith({ readerSoloOnFocus: false })
    expect(saveWorkspace).not.toHaveBeenCalledWith({ readerSolo: false })
    fireEvent.change(screen.getByRole("spinbutton", { name: "左右泳道展开延迟" }), { target: { value: "400" } })
    fireEvent.blur(screen.getByRole("spinbutton", { name: "左右泳道展开延迟" }))
    expect(saveWorkspace).toHaveBeenCalledWith({ edgeRevealDelayMs: 400 })
    expect(document.querySelectorAll("[data-reader-reveal-zone]")).toHaveLength(4)
    const revealCanvas = screen.getByLabelText("悬停唤出区画布")
    const callsBeforeClick = saveWorkspace.mock.calls.length
    fireEvent.pointerDown(revealCanvas, { pointerId: 7, button: 0, clientX: 40, clientY: 40 })
    fireEvent.pointerUp(revealCanvas, { pointerId: 7, clientX: 40, clientY: 40 })
    expect(saveWorkspace).toHaveBeenCalledTimes(callsBeforeClick)
    fireEvent.change(screen.getByRole("spinbutton", { name: "左侧唤出区x" }), { target: { value: "12" } })
    fireEvent.blur(screen.getByRole("spinbutton", { name: "左侧唤出区x" }))
    expect(saveWorkspace).toHaveBeenCalledWith({
      edgeRevealZones: {
        left: { x: 12, y: 10, width: 1, height: 80 },
        right: { x: 87, y: 10, width: 1, height: 80 },
        top: { x: 10, y: 0, width: 80, height: 1 },
        bottom: { x: 10, y: 99, width: 80, height: 1 },
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "上栏" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "上栏唤出区y" }), { target: { value: "8" } })
    fireEvent.blur(screen.getByRole("spinbutton", { name: "上栏唤出区y" }))
    expect(saveWorkspace).toHaveBeenCalledWith({
      edgeRevealZones: {
        left: { x: 12, y: 10, width: 1, height: 80 },
        right: { x: 87, y: 10, width: 1, height: 80 },
        top: { x: 10, y: 8, width: 80, height: 1 },
        bottom: { x: 10, y: 91, width: 80, height: 1 },
      },
    })
    fireEvent.click(screen.getByRole("switch", { name: "启用 Reader 悬停重新聚焦" }))
    expect(saveWorkspace).toHaveBeenCalledWith({ readerFocusOnHover: false })
    fireEvent.change(screen.getByRole("spinbutton", { name: "Reader 悬停重新聚焦延迟" }), { target: { value: "900" } })
    fireEvent.blur(screen.getByRole("spinbutton", { name: "Reader 悬停重新聚焦延迟" }))
    expect(saveWorkspace).toHaveBeenCalledWith({ readerFocusHoverDelayMs: 900 })
    selectTab("布局看板")
    fireEvent.click(await screen.findByRole("button", { name: "保存布局" }))
    expect(save).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "视图" }))
    expect(await screen.findByRole("heading", { name: "视图默认值" })).toBeTruthy()
    fireEvent.change(screen.getByRole("combobox", { name: "默认缩放模式" }), { target: { value: "fit-width" } })
    expect(saveViewDefaults).toHaveBeenCalledWith({ fitMode: "fit-width" })

    fireEvent.click(screen.getByRole("button", { name: "外观" }))
    expect(await screen.findByRole("heading", { name: "界面材质" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "通用" }))
    expect(await screen.findByRole("heading", { name: "幻灯片" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "影像" }))
    expect(await screen.findByRole("heading", { name: "影像" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "操作绑定" }))
    expect(await screen.findByRole("heading", { name: "操作绑定" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "快捷键" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "轮盘" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "数据" }))
    expect(await screen.findByRole("heading", { name: "数据与配置" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "关于" }))
    expect(await screen.findByRole("heading", { name: "关于 NeoView" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "系统" }))
    expect(await screen.findByRole("heading", { name: "系统" })).toBeTruthy()
    expect(screen.getByText(/排除路径/)).toBeTruthy()
  })

  it("[neoview.settings.bounds] mounts inside the reader surface with four-sided safe spacing", async () => {
    const readerSurface = document.createElement("div")
    readerSurface.dataset.readerApp = "true"
    document.body.appendChild(readerSurface)

    render(
      <ReaderSettingsWindow
        portalContainer={readerSurface}
        shell={shell()}
        viewDefaults={{ fitMode: "fit", pageMode: "single" }}
        inputBindings={{ bindings: [] }}
        radialMenu={DEFAULT_READER_RADIAL_MENU_CONFIG}
        onClose={vi.fn()}
        onBoardLayout={vi.fn(async () => undefined)}
        onViewDefaults={vi.fn(async () => undefined)}
        onInputBindings={vi.fn(async () => ({ bindings: [] }))}
        onRadialMenu={vi.fn(async () => DEFAULT_READER_RADIAL_MENU_CONFIG)}
        onMaterial={vi.fn(async () => shell())}
      />,
    )

    const dialog = within(readerSurface).getByRole("dialog")
    expect(document.body.contains(dialog)).toBe(true)
    expect(dialog.className).toContain("absolute")
    expect(dialog.className).toContain("inset-3")
    expect(dialog.className).toContain("sm:inset-4")
    expect(dialog.className).not.toContain("100vh")
    const overlay = readerSurface.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    expect(overlay?.className).toContain("absolute")
    readerSurface.remove()
  })
})

function media() {
  return {
    supportedImageFormats: ["jpg", "png", "webp"],
    videoFormats: ["mp4", "webm"],
    mediaMimeTypes: {},
    autoPlayAnimatedImages: true,
    animatedVideoEnabled: false,
    animatedVideoKeywords: ["[#dyna]"],
    videoMinPlaybackRate: 0.25,
    videoMaxPlaybackRate: 16,
    videoPlaybackRateStep: 0.25,
    subtitle: { fontSize: 18, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
  }
}

function selectTab(name: string) {
  const tab = screen.getByRole("tab", { name })
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.click(tab)
}

function shell(): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    workspace: {
      mode: "edges",
      swimlane: {
        laneOrder: ["left", "reader", "right"],
        activeLane: "reader",
        readerSolo: true,
        readerSoloOnFocus: true,
        readerWidthRatio: 0.5,
        edgeRevealDelayMs: 180,
        edgeRevealZones: {
          left: { x: 0, y: 10, width: 1, height: 80 },
          right: { x: 99, y: 10, width: 1, height: 80 },
          top: { x: 10, y: 0, width: 80, height: 1 },
          bottom: { x: 10, y: 99, width: 80, height: 1 },
        },
        readerFocusOnHover: true,
        readerFocusHoverDelayMs: 650,
        showLaneNavigatorInReaderSolo: false,
        lanes: {
          left: { width: 320, collapsed: false, activePanelId: "pageList" },
          reader: { width: 960, collapsed: false },
          right: { width: 280, collapsed: false, activePanelId: "info" },
        },
      },
    },
    panelLayout: {
      pageList: { visible: true, order: 0, position: "left" },
      info: { visible: true, order: 0, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}
